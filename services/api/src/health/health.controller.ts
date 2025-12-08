import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  uptime: number;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: process.uptime(),
    };
  }

  @Get('ready')
  ready(): { ready: boolean } {
    // TODO: Add database and redis connectivity checks
    return { ready: true };
  }

  @Get('live')
  live(): { live: boolean } {
    return { live: true };
  }
}
