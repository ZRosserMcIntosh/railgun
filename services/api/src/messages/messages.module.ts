import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity } from './message.entity';
import { DmConversationEntity } from './dm-conversation.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { DmService } from './dm.service';
import { DmController } from './dm.controller';
import { UsersModule } from '../users/users.module';
import { CommunitiesModule } from '../communities/communities.module';
import { RateLimitGuard } from '../auth/rate-limit.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageEntity, DmConversationEntity]),
    UsersModule,
    forwardRef(() => CommunitiesModule),
  ],
  controllers: [MessagesController, DmController],
  providers: [MessagesService, DmService, RateLimitGuard],
  exports: [MessagesService, DmService],
})
export class MessagesModule {}
