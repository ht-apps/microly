import { TrainingSessionSchema, type TrainingOption, type TrainingSession } from '@microly/content-schema'

type Difficulty = 'L1' | 'L2' | 'L3'
type Risk = 'low' | 'medium'

export interface BetaSessionSpec {
  catalogId: string
  catalogTitle: string
  sessionId: string
  title: string
  objective: string
  difficulty: Difficulty
  riskLevel: Risk
  scenario: string
  question: string
  recommended: string
  risky: string
  notRecommended: string
  principle: string
  formula: string
  practicePrompt: string
}

export const betaProductionPlan: BetaSessionSpec[] = [
  { catalogId: 'boundary-communication', catalogTitle: '边界沟通', sessionId: 'boundary-scope-011', title: '新增范围先确认取舍', objective: '需求范围临时增加时，说明新增工作量并确认时间、范围或资源中的取舍', difficulty: 'L1', riskLevel: 'low', scenario: '你正在按已确认范围制作活动页面，评审结束后对方又提出两个新模块，并默认发布日期保持不变。现有排期无法同时覆盖全部新增内容。', question: '你会怎样确认新的交付范围？', recommended: '新增两个模块后，原排期无法覆盖全部内容。我们可以保持日期并先交核心模块，或将完整版本顺延两天，你更希望哪个？', risky: '这些新增需求会影响排期，可能需要晚一点。', notRecommended: '需求总在变，这个时间肯定做不完。', principle: '范围变化要重新确认约束', formula: '变化事实 + 影响 + 可选取舍', practicePrompt: '对方临时增加交付范围，请写一句能够推动取舍确认的回复。' },
  { catalogId: 'boundary-communication', catalogTitle: '边界沟通', sessionId: 'boundary-after-hours-012', title: '确认非工作时间响应', objective: '收到非紧急的晚间请求时，说明可响应时间并保留真正紧急事项的沟通通道', difficulty: 'L1', riskLevel: 'low', scenario: '晚上九点，同事发来一份常规材料，希望你立即帮忙校对。材料明天下午才使用，你已经结束当天工作，但不想让对方误以为消息被忽略。', question: '你会怎样回复这条请求？', recommended: '消息收到了，这份材料明天下午使用，我明早十点前完成校对。如果有必须今晚确认的部分，请标出来告诉我。', risky: '我今晚没空，明天有时间再看。', notRecommended: '下班后不要再给我发工作消息。', principle: '边界清楚也要管理预期', formula: '确认收到 + 响应时间 + 紧急例外', practicePrompt: '面对一个不紧急的晚间请求，请写一句清楚说明响应时间的回复。' },
  { catalogId: 'boundary-communication', catalogTitle: '边界沟通', sessionId: 'boundary-meeting-013', title: '协商重复会议占用', objective: '会议持续占用执行时间时，用事实说明影响并提出更轻量的协作方式', difficulty: 'L2', riskLevel: 'low', scenario: '同一个项目每天安排两次进度会，每次都要四十分钟。大部分信息已经在协作文档中更新，频繁参会开始挤压你完成核心任务的时间。', question: '你会怎样提出调整建议？', recommended: '这周两次日会每天占用约八十分钟，已经影响核心任务推进。建议保留下午一次决策会，上午进展改为文档更新，可以试行一周吗？', risky: '现在会议太多了，最好都取消。', notRecommended: '我以后只挑重要的会参加。', principle: '用协作替代方案守住时间', formula: '占用事实 + 工作影响 + 替代机制', practicePrompt: '重复会议影响执行，请写一句包含事实和替代方式的建议。' },
  { catalogId: 'boundary-communication', catalogTitle: '边界沟通', sessionId: 'boundary-repeat-request-014', title: '处理反复临时请求', objective: '同类临时请求反复出现时，既承接当前事项，也推动建立稳定的需求入口', difficulty: 'L2', riskLevel: 'medium', scenario: '另一个团队本周第三次在下班前临时请你导出数据，每次都打断原有安排。今天的请求确实影响他们明早的会议，但长期继续这样会反复造成冲突。', question: '你会怎样处理当前请求并改善后续协作？', recommended: '今天这份会影响明早会议，我可以先在六点前提供核心数据。类似需求本周已出现三次，后续能否统一在每天下午三点前提交清单？', risky: '这次我可以帮忙，但以后请尽量早点说。', notRecommended: '临时需求我以后都不接了。', principle: '处理当下也要修复机制', formula: '当前承接 + 重复事实 + 新规则', practicePrompt: '面对反复出现的临时请求，请写一句兼顾当前交付与后续规则的回复。' },
  { catalogId: 'boundary-communication', catalogTitle: '边界沟通', sessionId: 'boundary-quality-speed-015', title: '协商速度与质量标准', objective: '时间被压缩时，明确可达到的质量范围并让负责人确认接受的标准', difficulty: 'L3', riskLevel: 'low', scenario: '负责人希望把原本三天完成的分析压缩到今天下班前。你可以提供初步结论，但无法在同一天完成全部数据核验和异常排查。', question: '你会怎样协商本次质量标准？', recommended: '今天下班前可以给出初步结论和主要数据，但完整核验与异常排查需要到后天。请确认今天先用于方向判断，还是保留完整标准按原计划交付？', risky: '赶时间的话我先做一个不太完整的版本。', notRecommended: '时间这么短，质量问题不能算我的。', principle: '压缩时间必须重设完成标准', formula: '可交付范围 + 未覆盖风险 + 标准确认', practicePrompt: '对方压缩交付时间，请写一句明确可交付质量范围的回复。' },

  { catalogId: 'clear-reporting', catalogTitle: '清晰汇报', sessionId: 'report-bad-news-016', title: '及时汇报坏消息', objective: '关键结果未达预期时，先说明结论，再交代原因、影响和下一步', difficulty: 'L1', riskLevel: 'low', scenario: '你负责的测试活动没有达到预期报名量，距离复盘会议还有半天。负责人尚不知道结果，并需要据此决定是否继续追加推广资源。', question: '你会怎样先行汇报？', recommended: '截至中午报名量为目标的六成，主要缺口来自渠道点击下降。若继续追加资源，建议先调整素材并观察半天，我会在四点前更新数据。', risky: '报名情况不太理想，我们还在分析原因。', notRecommended: '这次渠道效果很差，目标肯定完不成了。', principle: '坏消息要带着判断窗口汇报', formula: '结果结论 + 影响原因 + 下一步时间', practicePrompt: '一个关键指标未达预期，请写一句让负责人能够及时决策的汇报。' },
  { catalogId: 'clear-reporting', catalogTitle: '清晰汇报', sessionId: 'report-executive-summary-017', title: '向管理层做一分钟摘要', objective: '面对时间有限的管理者，先给结论和业务影响，再提供必要依据', difficulty: 'L1', riskLevel: 'low', scenario: '你需要在会议开场用一分钟说明一项体验优化的验证结果。管理者不了解实验细节，只关心是否值得继续投入以及可能带来的影响。', question: '你会怎样组织开场汇报？', recommended: '实验组完成率提升了八个百分点，暂未发现投诉增加，建议扩大到一半用户继续验证。详细样本和风险我放在后两页。', risky: '这次实验有很多数据，我先从方案背景讲起。', notRecommended: '效果很好，建议马上全量上线。', principle: '先回答管理者最关心的决定', formula: '核心结论 + 业务影响 + 建议动作', practicePrompt: '请为一次只有一分钟的管理层汇报写出开场结论。' },
  { catalogId: 'clear-reporting', catalogTitle: '清晰汇报', sessionId: 'report-dependency-decision-018', title: '依赖变化时请求决策', objective: '外部依赖影响计划时，量化影响并明确需要负责人决定的事项', difficulty: 'L2', riskLevel: 'low', scenario: '供应团队通知接口只能比原计划晚两天提供。你的团队可以等待完整接口，也可以先使用模拟数据推进，但后者会增加一次返工。', question: '你会怎样请求负责人决策？', recommended: '接口将晚两天，等待会把联调推迟到周五；先用模拟数据可保持周三进度，但需半天返工。请确认优先保日期还是减少返工？', risky: '接口延期了，我们可以等，也可以先自己想办法。', notRecommended: '对方延期导致计划没法继续，只能往后推。', principle: '汇报依赖要明确决策题', formula: '依赖变化 + 方案代价 + 决策问题', practicePrompt: '外部依赖发生变化，请写一句包含两个方案代价的请示。' },
  { catalogId: 'clear-reporting', catalogTitle: '清晰汇报', sessionId: 'report-explicit-request-019', title: '把请示事项说具体', objective: '汇报阻塞时，明确需要谁在什么时间做出哪项决定或支持', difficulty: 'L2', riskLevel: 'medium', scenario: '项目方案已完成，但两个部门对上线范围意见不同。团队无法继续排期，负责人只知道仍有争议，却不知道需要自己介入处理什么。', question: '你会怎样提出明确请示？', recommended: '两个部门对首发范围仍有分歧，排期今天无法锁定。请你在明天下午前确认先上线基础版还是等待完整范围，我会据此更新计划。', risky: '目前还有分歧，希望你能帮忙推动一下。', notRecommended: '他们一直谈不拢，这个项目没法排期。', principle: '请示必须可以直接回应', formula: '当前阻塞 + 决定事项 + 回复期限', practicePrompt: '项目因决策未定而阻塞，请写一句具体可回应的请示。' },
  { catalogId: 'clear-reporting', catalogTitle: '清晰汇报', sessionId: 'report-data-uncertainty-020', title: '说明数据的不确定性', objective: '数据尚不完整时，区分已知事实、暂时判断和待验证部分', difficulty: 'L3', riskLevel: 'low', scenario: '新功能上线一天后转化率看起来有所提升，但样本量还小，且当天恰逢一次渠道活动。负责人询问是否可以确认功能已经有效。', question: '你会怎样说明当前结论？', recommended: '目前转化率提升约五个百分点，但样本只有一天且受渠道活动影响，只能视为积极信号。建议再观察三天并拆分渠道后确认。', risky: '数据看起来不错，不过还不能完全确定。', notRecommended: '转化率已经提升，说明新功能有效。', principle: '把事实与判断的确定性分开', formula: '已知数据 + 不确定来源 + 验证计划', practicePrompt: '面对尚不充分的数据，请写一句区分事实、判断和验证计划的汇报。' },

  { catalogId: 'constructive-disagreement', catalogTitle: '表达异议', sessionId: 'disagree-evidence-021', title: '用证据质疑关键假设', objective: '发现方案建立在未经验证的假设上时，用证据提出验证问题而非直接否定', difficulty: 'L1', riskLevel: 'low', scenario: '团队准备增加一个复杂入口，理由是用户应该会需要。但最近访谈中，多数用户首先找不到已有功能，尚无证据表明新入口能够解决问题。', question: '你会怎样提出质疑？', recommended: '我认同要提升功能发现率，但现有访谈更集中在找不到入口。是否先用小范围原型验证新入口能解决这个问题，再决定完整开发？', risky: '这个方案的假设没有数据支持。', notRecommended: '用户根本不会需要这么复杂的入口。', principle: '质疑假设要给出验证路径', formula: '共同目标 + 现有证据 + 验证问题', practicePrompt: '方案依赖未经验证的假设，请写一句基于证据的质疑。' },
  { catalogId: 'constructive-disagreement', catalogTitle: '表达异议', sessionId: 'disagree-upward-022', title: '向负责人表达不同判断', objective: '与负责人判断不同时，先确认目标，再说明依据和需要讨论的风险', difficulty: 'L2', riskLevel: 'medium', scenario: '负责人希望本周直接替换所有用户的操作流程，以尽快看到效果。你根据以往数据判断一次全量切换会增加支持压力，但双方目标都是尽快验证价值。', question: '你会怎样表达不同判断？', recommended: '我认同要尽快验证效果。根据上次全量切换的支持量，我担心本周直接替换会影响用户处理。能否先覆盖两成用户，周三看数据后再扩大？', risky: '我觉得直接全量风险很大，最好听我的先灰度。', notRecommended: '既然你已经决定了，那就按你的方案做。', principle: '向上异议聚焦目标和依据', formula: '目标一致 + 判断依据 + 可验证替代', practicePrompt: '你与负责人判断不同，请写一句既清楚表达异议又推动验证的回复。' },
  { catalogId: 'constructive-disagreement', catalogTitle: '表达异议', sessionId: 'disagree-customer-impact-023', title: '用客户影响讨论取舍', objective: '方案取舍存在分歧时，把讨论拉回具体客户影响和可接受范围', difficulty: 'L2', riskLevel: 'low', scenario: '为了减少开发时间，团队建议暂时移除一种少量客户使用的导出格式。你发现这些客户虽然数量不多，却都在月末依赖该格式完成结算。', question: '你会怎样提出不同意见？', recommended: '减少格式能节省开发时间，但受影响客户都在月末用它结算。是否保留现有导出到本月底，并同步确认替代格式后再移除？', risky: '虽然用户少，但这个格式也不能随便删除。', notRecommended: '为了赶进度就先删掉，客户以后会适应的。', principle: '取舍要看影响强度而非只看数量', formula: '方案收益 + 客户影响 + 过渡建议', practicePrompt: '一个提速方案会影响少量关键客户，请写一句基于客户影响的异议。' },
  { catalogId: 'constructive-disagreement', catalogTitle: '表达异议', sessionId: 'disagree-experiment-024', title: '用低成本实验化解争论', objective: '双方缺少充分证据时，把立场争论转化为有期限和指标的小实验', difficulty: 'L2', riskLevel: 'low', scenario: '产品和运营对首页文案方向争论不下，双方都有合理经验，但没有当前用户数据。完整改版会占用一周，简单测试一天即可得到初步信号。', question: '你会怎样推动讨论继续？', recommended: '两个方向都有依据，现在缺少的是当前用户数据。我们能否各做一个轻量版本，明天用点击率和首训开始率比较后再确定？', risky: '继续讨论也不会有结果，不如随便选一个测试。', notRecommended: '我的文案经验更多，应该按我的方向做。', principle: '证据不足时先设计最小实验', formula: '承认依据 + 指出缺口 + 实验指标', practicePrompt: '双方观点都有道理但缺少数据，请写一句把争论转为实验的建议。' },
  { catalogId: 'constructive-disagreement', catalogTitle: '表达异议', sessionId: 'disagree-record-025', title: '记录暂未解决的分歧', objective: '无法当场达成一致时，明确分歧、决策人和后续确认时间', difficulty: 'L3', riskLevel: 'low', scenario: '跨团队会议临近结束，双方仍未就数据口径达成一致。今天必须先推进其他工作，但这个分歧会影响下周的指标验收，不能只用模糊表述带过。', question: '你会怎样结束这段讨论？', recommended: '目前分歧是退款订单是否计入转化，今天先不合并口径。请数据负责人周四前确认定义，我们按确认结果更新验收表。', risky: '这个问题以后再找时间讨论，今天先继续。', notRecommended: '既然谈不拢，就各自按自己的口径做。', principle: '未决分歧也要形成可跟进事项', formula: '分歧内容 + 决策责任 + 确认时间', practicePrompt: '会议无法解决关键分歧，请写一句能够记录并继续跟进的结论。' },

  { catalogId: 'action-alignment', catalogTitle: '推动协作', sessionId: 'action-recap-026', title: '会议结束前复述结论', objective: '讨论结束时，用简短复述确认决定、行动和仍待确认的事项', difficulty: 'L1', riskLevel: 'low', scenario: '一次跨团队讨论即将结束，会上确定了首发范围和时间，但还有一个数据口径需要会后确认。大家准备离开，尚未有人完整复述会议结论。', question: '你会怎样做最后确认？', recommended: '我复述一下：首发保留三个核心功能，周五上线；数据口径由分析同事明天下午前确认，若有变化再同步调整。大家理解一致吗？', risky: '今天讨论得差不多了，后续大家按计划推进。', notRecommended: '结论都写在会议记录里，大家自己看一下。', principle: '结束讨论前建立共同版本', formula: '决定 + 行动 + 待确认项', practicePrompt: '会议即将结束，请写一句包含决定、行动和待确认事项的复述。' },
  { catalogId: 'action-alignment', catalogTitle: '推动协作', sessionId: 'action-handoff-027', title: '交接时确认接收标准', objective: '任务交接时，明确交付物、接收人、验收标准和反馈时间', difficulty: 'L1', riskLevel: 'low', scenario: '你准备把一份数据清洗结果交给下游同事继续分析。文件已经生成，但双方尚未确认字段说明、异常值处理方式以及对方何时反馈是否可用。', question: '你会怎样完成这次交接？', recommended: '清洗文件和字段说明已放到共享目录，异常值按文档规则保留。请你明天下午前确认能否用于分析，有问题直接标在说明里。', risky: '文件已经发你了，看看是否能用。', notRecommended: '我这边已经做完，后面的问题由你们处理。', principle: '交付完成不等于交接完成', formula: '交付物 + 标准说明 + 接收反馈', practicePrompt: '把一项工作交给下游同事，请写一句明确接收标准和反馈时间的话。' },
  { catalogId: 'action-alignment', catalogTitle: '推动协作', sessionId: 'action-escalation-028', title: '逾期后进行事实升级', objective: '协作事项多次逾期时，基于事实和影响请求适当层级的协调', difficulty: 'L2', riskLevel: 'medium', scenario: '另一个团队承诺的数据已经两次延期，你分别提醒过并提供了所需格式。新的日期仍未确认，而本周发布计划将在明天受到直接影响。', question: '你会怎样发起升级协调？', recommended: '数据已从周一延期两次，目前仍无确认时间，明天会影响发布排期。我已补充格式并两次跟进，想请双方负责人今天一起确认交付时间或备用方案。', risky: '我已经催了很多次，只能请领导帮忙处理。', notRecommended: '对方一直不配合，发布延期责任不在我们。', principle: '升级是为了解决阻塞而非归责', formula: '事实记录 + 业务影响 + 协调请求', practicePrompt: '协作事项多次逾期，请写一句不指责个人的升级请求。' },
  { catalogId: 'action-alignment', catalogTitle: '推动协作', sessionId: 'action-decision-owner-029', title: '明确最终决策责任人', objective: '多人参与讨论时，区分提供意见者与最终决策人并确认决策期限', difficulty: 'L2', riskLevel: 'low', scenario: '三个团队都对活动方案提出了意见，但没有人明确谁拥有最终决定权。执行团队不断修改版本，距离启动只剩两天，再继续收集无边界意见会影响准备。', question: '你会怎样推动明确决策机制？', recommended: '三方意见已经汇总，为避免继续反复，请确认由活动负责人在今天五点前做最终取舍；其他同事继续提供依据，执行团队按最终版本推进。', risky: '意见太多了，需要找一个人拍板。', notRecommended: '我们先按自己的理解做，谁反对再调整。', principle: '协作意见与决策责任要分开', formula: '意见状态 + 决策人 + 决策期限', practicePrompt: '多人提供意见但没人拍板，请写一句明确决策责任和时间的推动语。' },
  { catalogId: 'action-alignment', catalogTitle: '推动协作', sessionId: 'action-unblock-030', title: '拆出跨团队最小解阻动作', objective: '跨团队依赖复杂时，识别最小必要输入并明确下一次同步节点', difficulty: 'L3', riskLevel: 'low', scenario: '合作团队暂时无法完成全部接口文档，但你只需要三个核心字段就能开始开发。双方如果继续等待完整文档，本周的准备时间会被全部消耗。', question: '你会怎样推动先解开当前阻塞？', recommended: '完整文档可以后补，我们今天启动只需要三个核心字段和示例。能否先在三点前提供这部分，剩余内容周四补齐，我们明早再同步一次？', risky: '文档来不及的话，先随便给我们一些字段。', notRecommended: '等完整文档准备好后我们再开始。', principle: '复杂依赖先找到最小可行动输入', formula: '最小输入 + 当前期限 + 下次同步', practicePrompt: '完整依赖暂时无法交付，请写一句推动最小输入先行的回复。' },
]

function rotateOptions(options: TrainingOption[], offset: number) {
  return options.map((_, index) => options[(index + offset) % options.length]!)
}

function optionsFor(spec: BetaSessionSpec, suffix: string, offset: number): TrainingOption[] {
  return rotateOptions([
    { id: `${suffix}-not-recommended`, text: spec.notRecommended, rating: 'not_recommended', feedback: { interpretation: '对方能听到你的态度，但难以据此采取下一步。', strength: '表达直接，立场容易被注意到。', risk: '缺少事实、影响或可确认的行动，容易让讨论停在立场上。', condition: '只适合双方已经完整确认背景和行动安排的极简场景。' } },
    { id: `${suffix}-risky`, text: spec.risky, rating: 'risky', feedback: { interpretation: '表达触及了当前问题，但关键信息仍需要对方继续追问。', strength: '已经主动暴露问题或提出了调整意图。', risk: '行动、范围或时间不够具体，双方可能形成不同理解。', condition: '适合紧接着能够进行实时追问和补充确认的场景。' } },
    { id: `${suffix}-recommended`, text: spec.recommended, rating: 'recommended', feedback: { interpretation: '表达把事实、影响和可回应的下一步连接起来。', strength: '对方可以直接理解约束，并对具体方案作出回应。', risk: '实际使用时仍需根据关系和紧急程度调整语气与细节。', condition: '适合常规、低风险的职场协作和任务沟通。' } },
  ], offset)
}

export function buildBetaSession(spec: BetaSessionSpec, index: number): TrainingSession {
  const baseOptions = optionsFor(spec, `${spec.sessionId}-base`, index % 3)
  const variants = [1, 2].map((number) => ({
    variantId: `${spec.sessionId}-review-${number}`,
    title: number === 1 ? `${spec.title}：条件变化` : `${spec.title}：对象变化`,
    context: number === 1
      ? `在另一个匿名职场协作中，原有条件临时发生变化。你仍需要${spec.objective}，并让对方能够直接确认下一步。`
      : `这次沟通对象和时间窗口有所不同，但学习目标保持一致。请在不评价个人的前提下${spec.objective}。`,
    question: number === 1 ? '面对条件变化，你会怎样回应？' : '换一个协作对象，你会怎样表达？',
    prompt: number === 1 ? '选择兼顾事实与下一步的表达' : '选择更容易形成共同理解的表达',
    options: optionsFor(spec, `${spec.sessionId}-review-${number}`, (index + number) % 3).map((option) => ({
      ...option,
      text: `${number === 1 ? '条件变化后' : '对象变化后'}：${option.text}`,
    })),
  }))
  return TrainingSessionSchema.parse({
    schemaVersion: '1.0', sessionId: spec.sessionId, contentVersion: 1, title: spec.title,
    objective: spec.objective, skill: spec.catalogId, difficulty: spec.difficulty, riskLevel: spec.riskLevel, estimatedMinutes: 3,
    cards: [
      { id: 'scenario', type: 'scenario', eyebrow: `${spec.catalogTitle} · 真实协作`, title: spec.title, context: spec.scenario, question: spec.question },
      { id: 'choice', type: 'choice', prompt: '选择一句更可能推动事情继续的表达', options: baseOptions },
      { id: 'feedback', type: 'feedback', title: '比较三种表达带来的协作结果', comparisonLabel: '事实、影响与下一步' },
      { id: 'principle', type: 'principle', title: spec.principle, summary: spec.objective, formula: spec.formula, counterexample: spec.notRecommended, example: spec.recommended },
      { id: 'practice', type: 'practice', title: '换一个相似场景主动表达', prompt: spec.practicePrompt, minLength: 10, maxLength: 200,
        dimensions: [
          { id: 'state-facts', title: '说明事实', description: '使用可核对的事实描述当前变化或约束。', keywords: ['目前', '已经', '截至', '需要'] },
          { id: 'explain-impact', title: '说明影响', description: '说明变化会影响的范围、时间或质量。', keywords: ['影响', '无法', '风险', '排期'] },
          { id: 'confirm-action', title: '确认下一步', description: '给出可回应的方案、动作或确认问题。', keywords: ['确认', '建议', '能否', '请'] },
        ], referenceAnswer: spec.recommended, disclaimer: '请勿填写真实姓名、联系方式、公司机密或其他敏感信息。' },
      { id: 'completion', type: 'completion', title: '完成本次训练', summary: `你已经练习了“${spec.principle}”。`, takeaway: spec.formula },
    ],
    reviewVariants: variants,
  })
}
