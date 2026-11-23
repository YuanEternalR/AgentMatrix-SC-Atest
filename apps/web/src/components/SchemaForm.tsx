import type { FieldSchema } from '../api';

/**
 * 按 JSON Schema 生成表单。
 *
 * 技能与工作流共用同一套字段描述（`{字段: {type,required,label,placeholder}}`），
 * 所以这里只认这一种简化结构——真接标准 JSON Schema 的话，
 * 一堆 $ref/oneOf 会把演示期的时间全吃掉，收益却不明显。
 */
export function SchemaForm({
  schema,
  values,
  onChange,
  testIdPrefix = 'field',
}: {
  schema: Record<string, FieldSchema>;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  testIdPrefix?: string;
}) {
  const entries = Object.entries(schema ?? {});
  if (entries.length === 0) {
    return <div className="step-meta">该技能没有声明输入字段，可直接执行</div>;
  }

  return (
    <div className="grid-2" style={{ gap: 12 }}>
      {entries.map(([key, spec]) => {
        const numeric = spec.type === 'integer' || spec.type === 'number';
        const isBool = spec.type === 'boolean';
        return (
          <div key={key}>
            <label className="field">
              {spec.label ?? key}
              {spec.required && <span style={{ color: 'var(--danger)' }}> *</span>}
            </label>
            {isBool ? (
              <select
                data-testid={`${testIdPrefix}-${key}`}
                value={values[key] ?? 'false'}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              >
                <option value="false">否</option>
                <option value="true">是</option>
              </select>
            ) : (
              <input
                data-testid={`${testIdPrefix}-${key}`}
                type={numeric ? 'number' : 'text'}
                value={values[key] ?? ''}
                placeholder={spec.placeholder ?? spec.description}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 表单值 → 请求体：数字字段要真的转成数字，否则后端会收到字符串 */
export function coerceValues(
  schema: Record<string, FieldSchema>,
  values: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema ?? {})) {
    const raw = values[key];
    if (raw === undefined || raw === '') continue;
    if (spec.type === 'integer') out[key] = Number.parseInt(raw, 10);
    else if (spec.type === 'number') out[key] = Number.parseFloat(raw);
    else if (spec.type === 'boolean') out[key] = raw === 'true';
    else out[key] = raw;
  }
  return out;
}
