# Rail Gun Production Infrastructure
# Cost-optimized: No NAT Gateway, public subnets, on-demand voice
# Pricing: $7/month or $77/year (2 months free)

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  default     = "production"
}

variable "domain_name" {
  description = "Domain name for the API"
  type        = string
}

variable "db_password" {
  description = "Database password"
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret"
  sensitive   = true
}

variable "recovery_code_secret" {
  description = "Recovery code encryption secret"
  sensitive   = true
}

variable "dm_id_secret" {
  description = "DM ID encryption secret"
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe secret key"
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook secret"
  sensitive   = true
  default     = ""
}

# =============================================================================
# Locals
# =============================================================================

locals {
  name_prefix = "railgun-${var.environment}"
  
  common_tags = {
    Project     = "railgun"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# =============================================================================
# Data Sources
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# =============================================================================
# VPC - Custom VPC with PUBLIC subnets only (NO NAT GATEWAY = $0)
# =============================================================================

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

# Internet Gateway (FREE)
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-igw"
  })
}

# Public Subnets (at least 2 for RDS/ElastiCache)
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 1}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Type = "public"
  })
}

# Route Table for Public Subnets
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# =============================================================================
# Security Groups
# =============================================================================

# API Security Group
resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-api"
  description = "Security group for Rail Gun API"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "API HTTP + WebSocket"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-api"
  })
}

# Voice Security Group (mediasoup needs UDP ports)
resource "aws_security_group" "voice" {
  name        = "${local.name_prefix}-voice"
  description = "Security group for Voice/mediasoup"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 3001
    to_port     = 3001
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Voice signaling"
  }

  # mediasoup RTC ports (UDP)
  ingress {
    from_port   = 40000
    to_port     = 49999
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "mediasoup RTC UDP"
  }

  # mediasoup RTC ports (TCP fallback)
  ingress {
    from_port   = 40000
    to_port     = 49999
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "mediasoup RTC TCP"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-voice"
  })
}

# RDS Security Group
resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Security group for RDS"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.voice.id]
    description     = "PostgreSQL from API/Voice"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rds"
  })
}

# Redis Security Group
resource "aws_security_group" "redis" {
  name        = "${local.name_prefix}-redis"
  description = "Security group for ElastiCache Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.voice.id]
    description     = "Redis from API/Voice"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis"
  })
}

# =============================================================================
# RDS PostgreSQL (Free Tier: db.t3.micro)
# =============================================================================

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db"
  subnet_ids = aws_subnet.public[*].id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db"
  })
}

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-db"

  engine               = "postgres"
  engine_version       = "15"
  instance_class       = "db.t3.micro"
  allocated_storage    = 20
  storage_type         = "gp2"
  
  db_name  = "railgun"
  username = "railgun"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  
  publicly_accessible = false
  skip_final_snapshot = true
  
  multi_az                = false
  backup_retention_period = 7
  
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db"
  })
}

# =============================================================================
# ElastiCache Redis
# =============================================================================

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-redis"
  subnet_ids = aws_subnet.public[*].id

  tags = local.common_tags
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.0"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  port                 = 6379
  
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]

  snapshot_retention_limit = 1

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-redis"
  })
}

# =============================================================================
# ECR Repository
# =============================================================================

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}-api"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = false
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-api"
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# =============================================================================
# CloudWatch Log Groups
# =============================================================================

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name_prefix}-api"
  retention_in_days = 14

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "voice" {
  name              = "/ecs/${local.name_prefix}-voice"
  retention_in_days = 7

  tags = local.common_tags
}

# =============================================================================
# IAM Roles
# =============================================================================

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "ecs_task_voice" {
  name = "${local.name_prefix}-voice-scaling"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "*"
      }
    ]
  })
}

# =============================================================================
# ECS Cluster
# =============================================================================

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = local.common_tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 1
    weight            = 1
    capacity_provider = "FARGATE"
  }
}

# =============================================================================
# ECS Task Definition - API
# =============================================================================

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "api"
    image = "${aws_ecr_repository.api.repository_url}:latest"
    
    portMappings = [{
      containerPort = 3001
      protocol      = "tcp"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "DATABASE_URL", value = "postgresql://railgun:${var.db_password}@${aws_db_instance.main.endpoint}/railgun" },
      { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379" },
      { name = "JWT_SECRET", value = var.jwt_secret },
      { name = "JWT_EXPIRY", value = "15m" },
      { name = "JWT_REFRESH_EXPIRY", value = "7d" },
      { name = "RECOVERY_CODE_SECRET", value = var.recovery_code_secret },
      { name = "DM_ID_SECRET", value = var.dm_id_secret },
      { name = "CORS_ORIGINS", value = "https://${var.domain_name},https://app.${var.domain_name}" },
      { name = "VOICE_ENABLED", value = "true" },
      { name = "STRIPE_SECRET_KEY", value = var.stripe_secret_key },
      { name = "STRIPE_WEBHOOK_SECRET", value = var.stripe_webhook_secret },
      { name = "VOICE_CLUSTER_ARN", value = aws_ecs_cluster.main.arn },
      { name = "VOICE_SERVICE_NAME", value = "${local.name_prefix}-voice" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])

  tags = local.common_tags
}

# =============================================================================
# ECS Task Definition - Voice (mediasoup)
# =============================================================================

resource "aws_ecs_task_definition" "voice" {
  family                   = "${local.name_prefix}-voice"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "voice"
    image = "${aws_ecr_repository.api.repository_url}:latest"
    
    portMappings = [
      { containerPort = 3001, protocol = "tcp" },
      { containerPort = 40000, protocol = "udp" },
      { containerPort = 40001, protocol = "udp" },
      { containerPort = 40002, protocol = "udp" },
      { containerPort = 40003, protocol = "udp" },
      { containerPort = 40004, protocol = "udp" },
      { containerPort = 40005, protocol = "udp" },
      { containerPort = 40006, protocol = "udp" },
      { containerPort = 40007, protocol = "udp" },
      { containerPort = 40008, protocol = "udp" },
      { containerPort = 40009, protocol = "udp" },
    ]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3001" },
      { name = "DATABASE_URL", value = "postgresql://railgun:${var.db_password}@${aws_db_instance.main.endpoint}/railgun" },
      { name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:6379" },
      { name = "JWT_SECRET", value = var.jwt_secret },
      { name = "VOICE_ENABLED", value = "true" },
      { name = "VOICE_ONLY_MODE", value = "true" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.voice.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "voice"
      }
    }

    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/v1/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  tags = local.common_tags
}

# =============================================================================
# ECS Services
# =============================================================================

resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  tags = local.common_tags
}

resource "aws_ecs_service" "voice" {
  name            = "${local.name_prefix}-voice"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.voice.arn
  desired_count   = 0

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.voice.id]
    assign_public_ip = true
  }

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  tags = local.common_tags
}

# =============================================================================
# S3 Bucket for App Updates
# =============================================================================

resource "aws_s3_bucket" "updates" {
  bucket = "${local.name_prefix}-updates-${data.aws_caller_identity.current.account_id}"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-updates"
  })
}

resource "aws_s3_bucket_public_access_block" "updates" {
  bucket = aws_s3_bucket.updates.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "updates" {
  bucket = aws_s3_bucket.updates.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.updates.arn}/*"
      }
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.updates]
}

# =============================================================================
# Cost Monitoring - Budget Alert
# =============================================================================

resource "aws_budgets_budget" "monthly" {
  name              = "${local.name_prefix}-monthly-budget"
  budget_type       = "COST"
  limit_amount      = "50"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["alerts@example.com"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["alerts@example.com"]
  }

  tags = local.common_tags
}

# =============================================================================
# Outputs
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "ecr_repository_url" {
  description = "ECR repository URL"
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_api_service_name" {
  description = "ECS API service name"
  value       = aws_ecs_service.api.name
}

output "ecs_voice_service_name" {
  description = "ECS Voice service name"
  value       = aws_ecs_service.voice.name
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.main.endpoint
}

output "redis_endpoint" {
  description = "Redis endpoint"
  value       = "${aws_elasticache_cluster.main.cache_nodes[0].address}:6379"
}

output "s3_updates_bucket" {
  description = "S3 bucket for app updates"
  value       = aws_s3_bucket.updates.bucket
}

output "s3_updates_url" {
  description = "S3 URL for app updates"
  value       = "https://${aws_s3_bucket.updates.bucket}.s3.amazonaws.com"
}
