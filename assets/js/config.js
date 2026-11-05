/* ============================================================
 * 卖家配置：品牌 / 联系方式 / 5×5 报告风格
 * ============================================================ */
(function (root) {
  'use strict';

  root.APP_CONFIG = {
    brand: '桃桃选机',
    brandEn: 'TAOTAO PICKS',
    handle: '@桃桃选机',
    title: '本命手机测试｜2 主推 + 3 备选',
    description:
      '6 个偏好排个序，20 道小题，算出一份专属购机画像，再用 DeepSeek 拿到 2 款主推 + 3 款备选。',

    // 换成你的小红书主页链接；留空则不显示「来找我」
    contactUrl: 'https://www.xiaohongshu.com/',
    contactLabel: '来小红书找我',

    footerNote: '本测试不收集个人信息 · 推荐结果由 AI 生成，价格与库存请以电商实时页面为准。',

    // 5 个配色 × 5 个装饰元素 = 25 种报告 / PDF 风格
    themes: [
      { id: 'peach', name: '蜜桃乌龙', emoji: '🍑' },
      { id: 'matcha', name: '抹茶奶盖', emoji: '🍵' },
      { id: 'taro', name: '芋泥波波', emoji: '🍠' },
      { id: 'soda', name: '海盐苏打', emoji: '🫧' },
      { id: 'caramel', name: '焦糖布丁', emoji: '🍮' }
    ],
    motifs: [
      { id: 'heart', name: '爱心', emoji: '♡', glyphs: ['♡', '♥', '✦'] },
      { id: 'star', name: '星星', emoji: '✦', glyphs: ['✦', '★', '✧'] },
      { id: 'flower', name: '小花', emoji: '✿', glyphs: ['✿', '❀', '❁'] },
      { id: 'cloud', name: '云朵', emoji: '☁', glyphs: ['☁', '☾', '✧'] },
      { id: 'ribbon', name: '蝴蝶结', emoji: '🎀', glyphs: ['❥', '♡', '〰'] }
    ],

    maxCodeUses: 10,
    enablePrint: true
  };
})(typeof window !== 'undefined' ? window : globalThis);
