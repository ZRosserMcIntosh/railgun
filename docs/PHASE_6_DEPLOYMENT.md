# Phase 6: Production Deployment - READY ✅

**Date:** January 11, 2026  
**Status:** Ready to Deploy

## Pricing Model

| Plan | Price | Billing |
|------|-------|---------|
| **Monthly** | $7/month | Recurring |
| **Yearly** | $77/year | 2 months free! |

## Cost-Optimized Architecture

### What We Avoided (Saves ~$50/month)
- ❌ NAT Gateway ($32/month) - Using public subnets instead
- ❌ ALB ($16/month) - Using CloudFlare (free) instead
- ❌ Container Insights ($5/month) - Disabled

### What We're Using
| Resource | Type | Cost | Notes |
|----------|------|------|-------|
| RDS PostgreSQL | db.t3.micro | $0* | Free tier (750 hrs/mo) |
| ElastiCache Redis | cache.t3.micro | ~$12/mo | Sessions, pub/sub |
| Fargate API | 256 CPU / 512 MB | ~$9/mo | Always running |
| Fargate Voice | 1024 CPU / 2 GB | ~$0-36/mo | On-demand only |
| S3 Updates | 5GB | $0* | Free tier |
| CloudWatch Logs | 14 days | ~$1/mo | Minimal retention |

**Total Base Cost: ~$22/month** (with free tier)
**Post Free Tier: ~$34/month**

### Voice Scaling (Cost-Efficient)
- Voice service starts at **0 instances**
- Scales up when users join voice channels
- Uses **Fargate Spot** (70% cheaper)
- Auto-shutdown after 5 min idle

## Revenue Projections

| Users | Paying (1%) | MRR | Costs | Profit | Margin |
|-------|-------------|-----|-------|--------|--------|
| 500 | 5 | $35 | $22 | +$13 | 37% |
| 1,000 | 10 | $70 | $34 | +$36 | 51% |
| 5,000 | 50 | $350 | $60 | +$290 | 83% |
| 10,000 | 100 | $700 | $100 | +$600 | 86% |
| 50,000 | 500 | $3,500 | $200 | +$3,300 | 94% |

**Breakeven: ~500 total users (5 paying)**

## Deployment Steps

### 1. Initialize Infrastructure
```bash
cd infra
./deploy.sh init
./deploy.sh plan
```

### 2. Review and Apply
```bash
./deploy.sh apply
```

### 3. Build and Push Docker Image
```bash
./deploy.sh build
```

### 4. Run Migrations
```bash
./deploy.sh migrate
```

### 5. Update ECS Service
```bash
./deploy.sh update
```

### Or Full Deploy (All Steps)
```bash
./deploy.sh deploy
```

## DNS Configuration (CloudFlare)

1. Add your domain to CloudFlare (free plan)
2. Create A record pointing to ECS task public IP
3. Enable "Proxied" for DDoS protection and SSL
4. Set SSL mode to "Full (strict)"

## Post-Deployment Checklist

- [ ] Infrastructure deployed via Terraform
- [ ] Docker image pushed to ECR
- [ ] ECS service running (1/1 tasks)
- [ ] Database migrations applied
- [ ] Health check passing: `https://api.railgun.chat/api/v1/health`
- [ ] DNS configured in CloudFlare
- [ ] SSL working (CloudFlare)
- [ ] Stripe keys configured
- [ ] Budget alerts set up

## Files Created

- `infra/terraform/main.tf` - Cost-optimized Terraform config
- `infra/terraform/terraform.tfvars` - Variables (gitignored)
- `infra/deploy.sh` - Deployment automation script

## Monitoring

Budget alert configured at:
- 80% forecasted ($40)
- 100% actual ($50)

Email notifications sent to alerts@example.com (update in main.tf)

## Next Steps After Deployment

1. **Set up Stripe** - Add keys to terraform.tfvars and redeploy
2. **Configure desktop app** - Point to production API URL
3. **Build releases** - Create signed installers for distribution
4. **Launch website** - Enable downloads
