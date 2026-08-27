import { Module } from '@nestjs/common';
import { AnalysesModule } from './analyses';
import { ArtifactsModule } from './artifacts';
import { AuditModule } from './audit';
import { AuthModule } from './auth';
import { OpportunitiesModule } from './opportunities';

@Module({
  imports: [AuthModule, OpportunitiesModule, ArtifactsModule, AnalysesModule, AuditModule],
})
export class AppModule {}
