type Platform = 'tiktok' | 'facebook' | 'instagram';
type Goal = 'completion' | 'engagement' | 'conversion' | 'follow';

const platformHints: Record<Platform, string[]> = {
  tiktok: [
    '节奏快、信息密度高，前 3 秒强钩子',
    '镜头切换频率高，强调视觉冲击与情绪爆点',
  ],
  facebook: [
    '强调清晰叙事与受众共鸣，适合更成熟人群',
    '前 5 秒突出价值点与结果预告',
  ],
  instagram: [
    '画面审美统一、节奏紧凑，强调视觉风格',
    '标题/字幕简短有力，强场景化展示',
  ],
};

const goalHints: Record<Goal, string[]> = {
  completion: [
    '设计完播提升点：10 秒内必须有反转或信息密度提升',
    '结尾回扣主题并给出价值总结，降低跳出',
  ],
  engagement: [
    '每 8-12 秒设置互动问题或投票引导',
    '增加争议点或观点对立以促评论',
  ],
  conversion: [
    '明确行动指令与下一步入口',
    '展示具体收益与案例证明',
  ],
  follow: [
    '结尾设置系列内容铺垫，引导关注',
    '强调长期价值与持续更新承诺',
  ],
};

export function buildPlatformConstraints(
  platform: Platform,
  goal: Goal,
  audience?: string,
  scenario?: string
): string {
  const parts: string[] = [];
  parts.push(`平台：${platform}`);
  parts.push(`目标：${goal}`);
  parts.push(...platformHints[platform]);
  parts.push(...goalHints[goal]);

  if (audience) parts.push(`目标人群：${audience}`);
  if (scenario) parts.push(`场景/品类：${scenario}`);

  return parts.map((item) => `- ${item}`).join('\n');
}
