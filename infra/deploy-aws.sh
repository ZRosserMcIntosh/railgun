#!/bin/bash
# Rail Gun - Deploy to AWS
# Usage: ./deploy.sh [init|plan|apply|destroy]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TERRAFORM_DIR="$SCRIPT_DIR/terraform"
API_DIR="$SCRIPT_DIR/../services/api"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check prerequisites
check_prereqs() {
    command -v terraform >/dev/null 2>&1 || error "Terraform not installed"
    command -v aws >/dev/null 2>&1 || error "AWS CLI not installed"
    command -v docker >/dev/null 2>&1 || error "Docker not installed"
    
    # Check AWS credentials
    aws sts get-caller-identity >/dev/null 2>&1 || error "AWS credentials not configured"
    
    log "Prerequisites check passed"
}

# Initialize Terraform
tf_init() {
    log "Initializing Terraform..."
    cd "$TERRAFORM_DIR"
    terraform init
}

# Plan changes
tf_plan() {
    log "Planning infrastructure changes..."
    cd "$TERRAFORM_DIR"
    terraform plan -out=tfplan
}

# Apply changes
tf_apply() {
    log "Applying infrastructure changes..."
    cd "$TERRAFORM_DIR"
    terraform apply tfplan
    
    # Get outputs
    log "Infrastructure deployed! Outputs:"
    terraform output
}

# Build and push Docker image
build_and_push() {
    log "Building and pushing Docker image..."
    
    cd "$TERRAFORM_DIR"
    ECR_URL=$(terraform output -raw ecr_repository_url)
    AWS_REGION=$(terraform output -raw 2>/dev/null | grep -A1 "aws_region" | tail -1 || echo "us-east-1")
    
    # Login to ECR
    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "$ECR_URL"
    
    # Build image
    cd "$API_DIR"
    docker build -t railgun-api .
    
    # Tag and push
    docker tag railgun-api:latest "$ECR_URL:latest"
    docker push "$ECR_URL:latest"
    
    log "Docker image pushed to ECR"
}

# Update ECS service
update_service() {
    log "Updating ECS service..."
    
    cd "$TERRAFORM_DIR"
    CLUSTER=$(terraform output -raw ecs_cluster_name)
    SERVICE=$(terraform output -raw ecs_api_service_name)
    
    aws ecs update-service \
        --cluster "$CLUSTER" \
        --service "$SERVICE" \
        --force-new-deployment \
        --region us-east-1
    
    log "ECS service update initiated"
}

# Run database migrations
run_migrations() {
    log "Running database migrations..."
    
    cd "$TERRAFORM_DIR"
    RDS_ENDPOINT=$(terraform output -raw rds_endpoint)
    
    # Get password from tfvars (careful with this)
    DB_PASSWORD=$(grep db_password terraform.tfvars | cut -d'"' -f2)
    
    cd "$API_DIR"
    DATABASE_URL="postgresql://railgun:$DB_PASSWORD@$RDS_ENDPOINT/railgun" pnpm migration:run
    
    log "Migrations completed"
}

# Destroy infrastructure
tf_destroy() {
    warn "This will DESTROY all infrastructure!"
    read -p "Are you sure? Type 'yes' to confirm: " confirm
    
    if [ "$confirm" = "yes" ]; then
        cd "$TERRAFORM_DIR"
        terraform destroy
    else
        log "Destroy cancelled"
    fi
}

# Full deployment
full_deploy() {
    check_prereqs
    tf_init
    tf_plan
    
    read -p "Apply these changes? (y/n): " confirm
    if [ "$confirm" = "y" ]; then
        tf_apply
        build_and_push
        update_service
        
        log "Waiting 60s for RDS to be ready..."
        sleep 60
        
        run_migrations
        
        log "🚀 Deployment complete!"
        log ""
        log "Next steps:"
        log "1. Point your domain DNS to the ECS task public IP"
        log "2. Set up CloudFlare for SSL and DDoS protection"
        log "3. Configure Stripe keys in terraform.tfvars"
    fi
}

# Main
case "${1:-}" in
    init)
        check_prereqs
        tf_init
        ;;
    plan)
        tf_plan
        ;;
    apply)
        tf_apply
        ;;
    build)
        build_and_push
        ;;
    update)
        update_service
        ;;
    migrate)
        run_migrations
        ;;
    destroy)
        tf_destroy
        ;;
    ""|deploy)
        full_deploy
        ;;
    *)
        echo "Usage: $0 [init|plan|apply|build|update|migrate|destroy|deploy]"
        exit 1
        ;;
esac
