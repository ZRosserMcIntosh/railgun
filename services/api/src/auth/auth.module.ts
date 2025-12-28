import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { AuthLoggingInterceptor } from './auth-logging.interceptor';
import { AuthSession } from './entities/auth-session.entity';
import { AuthSessionService } from './auth-session.service';
import { AuthSessionController } from './auth-session.controller';
import { AuthSessionGateway } from './auth-session.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthSession]),
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRY', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController, AuthSessionController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthSessionGateway,
    JwtStrategy,
    // Security: Sanitize auth endpoint logs
    {
      provide: APP_INTERCEPTOR,
      useClass: AuthLoggingInterceptor,
    },
  ],
  exports: [AuthService, AuthSessionService, JwtStrategy],
})
export class AuthModule {}
