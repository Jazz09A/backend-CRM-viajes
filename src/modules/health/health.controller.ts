import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/roles.decorator';
import { ApiError } from '../../common/errors';

@Controller()
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Public()
  @Get('health')
  health() {
    return { estado: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.ds.query('SELECT 1');
      return { estado: 'listo', db: 'ok' };
    } catch {
      throw new ApiError(503, 'NO_LISTO', 'El servicio no está listo');
    }
  }
}
