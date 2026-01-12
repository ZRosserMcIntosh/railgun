import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { GroupsService } from './groups.service';
import { StripeConnectService } from './stripe-connect.service';
import { IapVerificationService } from './iap-verification.service';
import { GroupsController, StripeConnectController } from './groups.controller';

// Entities
import { GroupPlanEntity } from './entities/group-plan.entity';
import { GroupMembershipEntity } from './entities/group-membership.entity';
import { StripeConnectAccountEntity } from './entities/stripe-connect-account.entity';
import { GroupJoinRequestEntity } from './entities/group-join-request.entity';

// Import CommunityEntity from communities module (used for group operations)
import { CommunityEntity } from '../communities/community.entity';
import { MemberEntity } from '../communities/member.entity';
import { RoleEntity } from '../communities/role.entity';

// Import CommunitiesModule for service access
import { CommunitiesModule } from '../communities/communities.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => CommunitiesModule),
    TypeOrmModule.forFeature([
      // Group-specific entities
      GroupPlanEntity,
      GroupMembershipEntity,
      StripeConnectAccountEntity,
      GroupJoinRequestEntity,
      // Community entities for group operations
      CommunityEntity,
      MemberEntity,
      RoleEntity,
    ]),
  ],
  controllers: [GroupsController, StripeConnectController],
  providers: [GroupsService, StripeConnectService, IapVerificationService],
  exports: [GroupsService, StripeConnectService, IapVerificationService],
})
export class GroupsModule {}
