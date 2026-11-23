/**
 * 界面文案映射：把后端的英文代码翻译成中文，用户看得懂。
 *
 * 原则：
 * - 代码（code）仍是系统标识，接口与数据库不改；
 * - 只在**展示层**翻译，UI 上不出现裸英文标识符；
 * - 映射表集中在这里，新增代码只改这一处；
 * - 查不到时回退到原值，但尽量把常见代码补齐。
 */

/** 取中文名，查不到时返回原值 */
export function label(map: Record<string, string>, code: string | null | undefined, fallback = '—'): string {
  if (!code) return fallback;
  return map[code] ?? code;
}

export const STRATEGY_LABEL: Record<string, string> = {
  s0_all_large: '全用大模型',
  s1_fixed_rule: '固定规则',
  s2_weighted: '加权打分',
  s3_cost_aware: '成本优先',
  s4_llm_planner: '大模型规划',
};

export const STRATEGY_SHORT: Record<string, string> = {
  s0_all_large: 'S0 全大模型',
  s1_fixed_rule: 'S1 固定规则',
  s2_weighted: 'S2 加权打分',
  s3_cost_aware: 'S3 成本优先',
  s4_llm_planner: 'S4 大模型规划',
};

export const ERROR_CODE_LABEL: Record<string, string> = {
  TRANSIENT: '瞬时故障（可重试）',
  RATE_LIMIT: '上游限流（可重试）',
  UPSTREAM: '上游异常（可重试）',
  TIMEOUT: '调用超时（可重试）',
  VALIDATION: '参数不合法',
  PERMISSION: '权限不足',
  BUSINESS: '业务规则拒绝',
  UNKNOWN: '未知错误',
};

export const NODE_TYPE_LABEL: Record<string, string> = {
  start: '开始',
  skill: '技能',
  agent: '智能体',
  condition: '条件',
  approval: '审批',
  end: '结束',
};

export const TIER_LABEL: Record<string, string> = {
  large: '大模型',
  small: '小模型',
  tool: '工具',
};

export const STAGE_LABEL: Record<string, string> = {
  demand: '需求计划',
  sourcing: '采购寻源',
  production: '生产协同',
  inventory: '仓储库存',
  logistics: '运输物流',
  fulfillment: '履约交付',
  returns: '售后逆向',
  risk: '合规风控',
  research: '科研流程',
};

export const CAPABILITY_LABEL: Record<string, string> = {
  order_query: '订单查询',
  impact_assess: '影响评估',
  notify: '客户通知',
  inventory_query: '库存查询',
  supplier_score: '供应商评分',
  fulfillment_stats: '履约统计',
  segment_analysis: '分群分析',
  carrier_quote: '运价查询',
  negotiation: '谈判建议',
  reasoning: '推理',
  planning: '规划',
  synthesis: '归纳',
  writing: '写作',
  literature_search: '文献检索',
  relevance_screen: '相关性筛选',
};

export const WORKFLOW_LABEL: Record<string, string> = {
  order_delay_exception: '订单延迟异常闭环',
  fulfillment_review: '区域履约诊断与整改',
};

export const SEVERITY_LABEL: Record<string, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重',
};

export const ALERT_STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  acknowledged: '已确认',
  resolved: '已恢复',
};

export const PLANNED_BY_LABEL: Record<string, string> = {
  llm: '大模型规划',
  rule: '规则兜底',
};

/** 角色（与后端 RBAC 一致） */
export const ROLE_LABEL: Record<string, string> = {
  admin: '管理员',
  developer: '开发者',
  operator: '运营',
  viewer: '只读',
};

/**
 * 审计动作的中文名。
 *
 * 后端 `/audit-logs` 已经返回 action_label，这里是同一套口径的前端副本：
 * 仅用于"按动作筛选"等拿不到接口返回值的场景，两边改动需同步。
 */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'auth.login': '登录',
  'auth.login_failed': '登录失败',
  'task.create': '创建任务',
  'workflow.publish': '发布工作流版本',
  'approval.decide': '审批决策',
  'dead_letter.retry': '死信重试',
  'dead_letter.ignore': '死信忽略',
  'alert_rule.create': '新建告警规则',
  'alert_rule.update': '修改告警规则',
  'alert_rule.delete': '删除告警规则',
  'alert.ack': '确认告警',
  'alert.resolve': '恢复告警',
};

/** 审计变更字段的中文名（与后端 services/redaction.py 的 FIELD_LABELS 同步） */
export const AUDIT_FIELD_LABEL: Record<string, string> = {
  enabled: '启用状态',
  threshold: '阈值',
  severity: '级别',
  name: '名称',
  metric: '指标',
  operator: '比较符',
  decision: '决策',
  comment: '审批意见',
  status: '状态',
  version: '版本',
  changelog: '变更说明',
  priority: '优先级',
  title: '标题',
  reason: '原因',
};

/** 把能力编码列表转成中文短语 */
export function capabilitiesText(codes: string[], empty = '无'): string {
  if (!codes || codes.length === 0) return empty;
  return codes.map((c) => CAPABILITY_LABEL[c] ?? c).join('、');
}

/** 任务/运行步骤状态 */
export const STATUS_TEXT: Record<string, string> = {
  succeeded: '成功',
  running: '运行中',
  queued: '排队中',
  waiting_approval: '待审批',
  pending: '待处理',
  failed: '失败',
  canceled: '已取消',
  skipped: '跳过',
  retrying: '重试中',
  dispatching: '分配中',
};

/** 内置智能体的中文名（名称以数据库为准，这里用于淘汰候选等只有编码的场景） */
export const AGENT_LABEL: Record<string, string> = {
  'fulfillment-triage': '履约分诊智能体',
  'express-triage': '履约异常处理智能体',
  'exception-rules': '异常规则引擎',
  'inventory-optimizer': '库存优化智能体',
  'demand-planner': '需求计划智能体',
  'logistics-router': '物流调度智能体',
  'risk-inspector': '合规风控智能体',
  buyer: '采购寻源智能体',
  'fulfillment-analyst': '区域履约诊断智能体',
  'literature-scout': '文献检索智能体',
  'research-writer': '综述撰写智能体',
};
