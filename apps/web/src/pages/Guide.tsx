import { Link } from 'react-router-dom';

/**
 * 设计指南：把"技能 / 能力 / 策略"三个概念讲清楚。
 *
 * 为什么需要这一页：用户反馈"不知道怎么设计 skill 与策略、怎么注册、怎么给智能体加能力"。
 * 这不是用户的问题——是产品把四个概念并排摆出来却没画关系图。
 * 所以这页只做一件事：用一条真实链路把概念串起来，并给出可直达的操作入口。
 */

const STEPS = [
  {
    title: '① 技能：把「能做什么」变成一个可调用单元',
    body: '技能是原子能力，有输入/输出契约。内置函数直接读写数据；HTTP 技能对接外部系统（默认 Mock，离线可演示）。',
    detail: '设计要点：输入 Schema 决定试运行表单长什么样，所以字段名要贴合业务（order_id、region），不要写 param1。',
    to: '/skills',
    action: '去技能库',
    testId: 'guide-skill',
  },
  {
    title: '② 智能体：把技能「装备」到执行者身上，并声明能力标签',
    body: '智能体 = 角色提示词 + 模型档位 + 绑定的技能。能力标签（capability）是调度匹配用的键：任务声明需要什么能力，系统就按它选智能体。',
    detail: '关键区分：技能是"实现"，能力标签是"招聘条件"。一个智能体可以有 3 个技能，但只挂 1 个能力标签；任务只认能力标签。',
    to: '/agents',
    action: '去智能体',
    testId: 'guide-agent',
  },
  {
    title: '③ 工作流：声明这一步要谁做',
    body: '工作流节点可以是技能节点（直接调技能）或智能体节点（交给被选中的智能体）。工作流级的 required_capabilities 决定"这活要求谁能接"。',
    detail: '常见错误：技能建好了但没绑到智能体，调度永远选不到它；或者工作流要求的能力没有任何智能体声明。',
    to: '/workflows',
    action: '去工作流',
    testId: 'guide-workflow',
  },
  {
    title: '④ 任务：按能力路由，并留下打分依据',
    body: '发起任务后，系统先硬过滤（能力/状态/并发），再按策略打分选出执行者，最后把因子拆解落库，任务详情里能看到"为什么派给它"。',
    detail: '所以"能力标签写错"会在任务详情里表现为"硬过滤淘汰全部候选"——不是在技能里报错，而是在调度阶段。',
    to: '/',
    action: '去工作台',
    testId: 'guide-task',
  },
];

const PITFALLS = [
  {
    title: '能力标签 ≠ 技能编码',
    text: '技能编码是实现的标识（carrier_quote），能力标签是调度匹配的键（carrier_quote 也可以叫 quote_lookup）。名字可以一样，含义不同——任务只认能力标签。',
  },
  {
    title: '技能没绑到智能体，就等于没有',
    text: '技能的"被引用次数"为 0 时说明没有已发布的智能体或工作流在用它。调度按智能体选人，不会因为库里有个技能就派给它。',
  },
  {
    title: '工作流要求的能力，必须有智能体声明',
    text: '否则硬过滤会淘汰所有候选，任务停在 pending。排查顺序：看任务详情里的"被淘汰的候选"→ 原因通常是"缺少能力 xxx"。',
  },
  {
    title: '改了要发版本，不是原地改',
    text: '技能改配置、智能体改提示词都会生成新版本；运行锁定版本，所以改完要发布，线上才会用新的。草稿不影响任何线上行为。',
  },
];

export function Guide() {
  return (
    <>
      <div className="card">
        <h2 className="card-title">一条链路看懂四个概念</h2>
        <p className="card-sub">
          技能是「实现」，智能体是「执行者 + 能力声明」，工作流是「编排」，任务靠「能力」被路由到人。
          下面这条链就是你设计一个能力的完整路径。
        </p>

        <div className="guide-flow">
          <div className="guide-node">
            <strong>技能</strong>
            <span className="step-meta">能做什么</span>
          </div>
          <div className="guide-arrow">绑定 →</div>
          <div className="guide-node">
            <strong>智能体</strong>
            <span className="step-meta">谁来做 + 能力标签</span>
          </div>
          <div className="guide-arrow">编排 →</div>
          <div className="guide-node">
            <strong>工作流</strong>
            <span className="step-meta">按什么顺序做</span>
          </div>
          <div className="guide-arrow">发起 →</div>
          <div className="guide-node">
            <strong>任务</strong>
            <span className="step-meta">按能力路由</span>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {STEPS.map((step) => (
          <div className="card" key={step.title}>
            <h3 className="card-title">{step.title}</h3>
            <p className="card-sub">{step.body}</p>
            <p className="card-sub" style={{ color: 'var(--text-2)' }}>
              {step.detail}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Link to={step.to}>
                <button className="ghost" data-testid={step.testId}>
                  {step.action} →
                </button>
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="card-title">策略怎么选、怎么调</h2>
        <p className="card-sub">
          策略决定"在合格候选里挑谁"。产品默认用加权打分；研究对比时用 s0/s1 作基线。
          权重不必凑满 100%，系统内部按总和归一。
        </p>

        <table>
          <thead>
            <tr>
              <th>场景</th>
              <th>建议策略</th>
              <th>理由</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ cursor: 'default' }}>
              <td>日常生产</td>
              <td>加权打分（默认）</td>
              <td>能力/成功率/负载/成本/时延综合权衡，且每个因子都可解释</td>
            </tr>
            <tr style={{ cursor: 'default' }}>
              <td>降本压力大</td>
              <td>SLA 约束下的成本优先</td>
              <td>先按 SLA 留余量筛掉高风险，再取单价最低；代价是成功率可能下降</td>
            </tr>
            <tr style={{ cursor: 'default' }}>
              <td>关键任务、质量优先</td>
              <td>全大模型（基线）</td>
              <td>固定走强模型，用作"质量上限"对照组</td>
            </tr>
            <tr style={{ cursor: 'default' }}>
              <td>论文对比实验</td>
              <td>五种都要跑</td>
              <td>s1 是无反馈下界，s0 是质量上界，s4 是大模型规划+规则校验</td>
            </tr>
          </tbody>
        </table>

        <p className="card-sub" style={{ marginTop: 12 }}>
          调权重的正确姿势是「改 → 试算 → 保存」：在调度策略页拖动权重，用真实候选集试算，
          确认排名符合预期再保存。保存后下一次调度立即生效，Worker 不需重启。
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link to="/settings/dispatch">
            <button className="primary" data-testid="guide-dispatch">
              去调策略与权重 →
            </button>
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">四个常见坑</h2>
        <div className="grid-2" style={{ marginTop: 10 }}>
          {PITFALLS.map((item) => (
            <div key={item.title}>
              <strong style={{ fontSize: 13 }}>{item.title}</strong>
              <p className="card-sub" style={{ marginBottom: 10 }}>
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
