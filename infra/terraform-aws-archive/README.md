# AWS Terraform Infrastructure (Archived)

**Status:** ARCHIVED - Not actively used

This directory contains the original AWS Terraform infrastructure that was used during initial development.

## Why Archived?

Rail Gun has migrated to **Fly.io** for production deployment:

1. **Simpler deployment** - No VPC, NAT Gateway, or complex networking
2. **Lower operational overhead** - Managed platform vs raw IaC
3. **Better cost model** - Pay for what you use, no minimum infrastructure costs
4. **Edge networking** - Built-in global distribution

## Current Infrastructure

See `docs/DEPLOYMENT.md` for the current Fly.io deployment guide.

## If You Need AWS

These files are preserved for reference if you need to deploy to AWS:

- `main.tf` - Full AWS infrastructure (VPC, ECS, RDS, ElastiCache)
- `terraform.tfvars.example` - Example variable values
- `deploy.sh` - Deployment script (located at `../deploy-aws.sh`)

**Note:** The AWS infrastructure was designed for ~$7/month minimum cost but requires:
- AWS account with appropriate permissions
- Terraform CLI
- AWS CLI configured

To use, copy files back to `terraform/` and follow the original deployment process.
