export type AppTab = 'cloner' | 'native' | 'history';

export interface ParsedApkManifest {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
  appLabel: string | null;
  appLabelIsResource: boolean;
  permissions: string[];
  authorities: string[];
  activitiesCount: number;
  servicesCount: number;
  receiversCount: number;
}

export interface ApkInspectionSummary {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  hasResourcesArsc: boolean;
  dexFiles: string[];
  nativeAbis: string[];
  manifest: ParsedApkManifest;
}

export interface ClonedApkRecord {
  id: string;
  originalFileName: string;
  originalPackage: string;
  clonedPackage: string;
  clonedLabel: string;
  versionName: string;
  sizeBytes: number;
  downloadUrl: string;
  createdAt: number;
}
