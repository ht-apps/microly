import { Text, View } from '@tarojs/components'
import '../legal.scss'

export default function AiInfoPage() {
  return <View className='legal-page'>
    <Text className='legal-badge'>测试版 · AI 生成内容</Text>
    <Text className='legal-title'>AI 表达点评说明</Text>
    <Text className='legal-copy'>AI 点评只围绕课程预设的表达维度，帮助检查目标、事实或边界、下一步和语气。它不会评价人格、情绪、职业能力，也不代表唯一正确答案。</Text>
    <Text className='legal-heading'>数据如何处理</Text>
    <Text className='legal-copy'>只有在你明确点击获取点评后，当前表达才会发送给 DeepSeek。微习不保存原文，只保存不可逆摘要、结构化点评、模型版本、耗时和用量。请勿输入真实姓名、联系方式、公司机密或高风险事件详情。</Text>
    <Text className='legal-heading'>额度与降级</Text>
    <Text className='legal-copy'>微信登录账号默认每天可请求 5 次。离线、超额、模型失败或 API 重启时，训练仍可完成，并使用基于课程关键词的本地结构检查。</Text>
    <Text className='legal-heading'>结果局限</Text>
    <Text className='legal-copy'>模型可能出现遗漏、不准确或不适用于具体关系的建议。涉及法律、安全、危机、劳动争议等情况时，请使用正式渠道或寻求专业支持。</Text>
  </View>
}
