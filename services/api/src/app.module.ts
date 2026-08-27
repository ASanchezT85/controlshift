import { Module } from '@nestjs/common';
import { AnalysesModule } from './analyses';
import { ArtifactsModule } from './artifacts';
import { AuditModule } from './audit';
import { AuthModule } from './auth';
import { BrandingModule } from './branding';
import { CommercialModule } from './commercial';
import { EstimatingModule } from './estimating';
import { OpportunitiesModule } from './opportunities';
import { ReportsModule } from './reports';

@Module({
  imports: [
    AuthModule,
    OpportunitiesModule,
    ArtifactsModule,
    AnalysesModule,
    EstimatingModule,
    CommercialModule,
    BrandingModule,
    ReportsModule,
    AuditModule,
  ],
})
export class AppModule {}
