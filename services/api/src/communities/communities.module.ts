import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityEntity } from './community.entity';
import { ChannelEntity } from './channel.entity';
import { MemberEntity } from './member.entity';
import { RoleEntity } from './role.entity';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';
import { ChannelsController } from './channels.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunityEntity,
      ChannelEntity,
      MemberEntity,
      RoleEntity,
    ]),
  ],
  controllers: [CommunitiesController, ChannelsController],
  providers: [CommunitiesService],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
