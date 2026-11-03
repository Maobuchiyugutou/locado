// 快照结构版本与应用版本分开：只有存储结构发生不兼容变化时才递增。
export const CURRENT_SCHEMA_VERSION = 2;

export class UnsupportedSchemaVersionError extends Error {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super(`数据版本 ${schemaVersion} 高于当前支持的版本 ${CURRENT_SCHEMA_VERSION}`);
    this.name = "UnsupportedSchemaVersionError";
    this.schemaVersion = schemaVersion;
  }
}

export interface MigrationResult {
  data: Record<string, unknown>;
  sourceVersion: number;
  migrated: boolean;
}

function readVersion(record: Record<string, unknown>): number {
  if (record.schemaVersion === undefined) return 1;
  const version = record.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("数据版本号无效");
  }
  return version;
}

export function migrateSnapshotRecord(raw: unknown): MigrationResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { data: {}, sourceVersion: 1, migrated: false };
  }
  const source = raw as Record<string, unknown>;
  const sourceVersion = readVersion(source);
  if (sourceVersion > CURRENT_SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(sourceVersion);

  let data = { ...source };
  let version = sourceVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    if (version === 1) {
      // 版本 1 没有显式版本字段；版本 2 只补充版本信息，不改变任务内容。
      data = { ...data, schemaVersion: 2 };
      version = 2;
    } else {
      throw new Error(`缺少从数据版本 ${version} 开始的迁移`);
    }
  }
  return { data, sourceVersion, migrated: sourceVersion !== CURRENT_SCHEMA_VERSION };
}
