/* ============================================================
 * 题库与示例数据
 * 想改题目 / 选项，只改这个文件即可，页面会自动适配。
 * 注意：总题数（含第 1 题排序）不要超过 30。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.QUIZ_DATA = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------- 六个权重维度（第 1 题排序用） ---------- */
  const DIMS = [
    {
      id: 'price',
      name: '价格',
      emoji: '💰',
      color: '#E9899B',
      soft: '#FFE6EB',
      desc: '预算和性价比'
    },
    {
      id: 'brand',
      name: '品牌',
      emoji: '🎀',
      color: '#B49BE6',
      soft: '#F0E9FF',
      desc: '品牌和生态'
    },
    {
      id: 'video',
      name: '视频',
      emoji: '🎬',
      color: '#78B9DE',
      soft: '#E6F4FC',
      desc: 'vlog、演唱会、记录'
    },
    {
      id: 'photo',
      name: '拍照',
      emoji: '📷',
      color: '#E7A05C',
      soft: '#FFF0DF',
      desc: '人像、自拍、夜景'
    },
    {
      id: 'audio',
      name: '听歌',
      emoji: '🎧',
      color: '#69C3A1',
      soft: '#E5F7F0',
      desc: '音质、外放、降噪'
    },
    {
      id: 'gaming',
      name: '打游戏',
      emoji: '🎮',
      color: '#A98BD6',
      soft: '#F0E9FF',
      desc: '帧率、散热、触控'
    }
  ];

  /* ---------- 每进入一个板块时说的一句话 ---------- */
  const SECTION_INTROS = {
    price: '先聊聊预算，这是最实在的一条线。',
    brand: '品牌这件事，喜欢和顺手都很重要。',
    video: '你拍视频的样子，决定了我怎么选。',
    photo: '拍照，是很多女孩换机的第一理由。',
    audio: '耳机一戴，世界就是你的。',
    gaming: '游戏体验，帧率和散热都要算数。',
    universal: '最后几个小问题，帮你把坑排掉。'
  };

  /* ---------- 题库 ----------
   * type: single / multi
   * deep: true 表示「进阶题」，只有该维度排进前 3 才会问
   * plabel: 写进 AI prompt 时的短标签
   */
  const QUESTIONS = [
    /* ===== 价格 ===== */
    {
      id: 'p1',
      dim: 'price',
      deep: false,
      type: 'single',
      plabel: '预算',
      title: '你的预算大概是多少？',
      hint: '按到手价算，选最接近的一档就好。',
      options: [
        { k: 'under2k', emoji: '🌱', label: '2,000 元以下', note: '够用、耐用就好' },
        { k: '2k3k', emoji: '🌿', label: '2,000–3,000 元', note: '性价比优先' },
        { k: '3k4k', emoji: '🍑', label: '3,000–4,000 元', note: '主流甜点价位' },
        { k: '4k55', emoji: '🌸', label: '4,000–5,500 元', note: '可以上旗舰' },
        { k: '55k7k', emoji: '✨', label: '5,500–7,000 元', note: '想要更好的体验' },
        { k: 'over7k', emoji: '👑', label: '7,000 元以上', note: '预算比较充裕' },
        { k: 'flex', emoji: '💭', label: '没有硬预算，看值不值', note: '合适就冲' }
      ]
    },
    {
      id: 'p2',
      dim: 'price',
      deep: false,
      type: 'single',
      plabel: '购机方式',
      title: '你打算怎么买？',
      hint: '不同渠道，性价比的算法不一样。',
      options: [
        { k: 'new', emoji: '📦', label: '只买全新国行' },
        { k: 'prev', emoji: '🕰️', label: '上代旗舰 / 官翻也可以', note: '更划算' },
        { k: 'used', emoji: '💫', label: '成色好的二手也行' },
        { k: 'trade', emoji: '🔁', label: '以旧换新，抵扣后看价' },
        { k: 'contract', emoji: '📱', label: '合约机或分期' }
      ]
    },
    {
      id: 'p3',
      dim: 'price',
      deep: true,
      type: 'single',
      plabel: '打算用多久',
      title: '这台手机你打算用多久？',
      hint: '用得越久，越值得为耐用和系统更新花钱。',
      options: [
        { k: '1y', emoji: '🐣', label: '1 年左右就换' },
        { k: '2y', emoji: '🌱', label: '2–3 年' },
        { k: '3y', emoji: '🌳', label: '3–5 年' },
        { k: '5y', emoji: '🪴', label: '用到坏为止' }
      ]
    },

    /* ===== 品牌 ===== */
    {
      id: 'b1',
      dim: 'brand',
      deep: false,
      type: 'single',
      plabel: '品牌偏好',
      title: '品牌上，你有没有偏爱？',
      hint: '没有偏好也完全没关系，选最后一项。',
      options: [
        { k: 'apple', emoji: '🍎', label: '苹果' },
        { k: 'huawei', emoji: '🌸', label: '华为' },
        { k: 'xiaomi', emoji: '🟠', label: '小米' },
        { k: 'oppo', emoji: '💚', label: 'OPPO' },
        { k: 'vivo', emoji: '🔵', label: 'vivo' },
        { k: 'honor', emoji: '✨', label: '荣耀' },
        { k: 'samsung', emoji: '🌀', label: '三星' },
        { k: 'none', emoji: '🤍', label: '没有特别偏好', note: '看产品说话' }
      ]
    },
    {
      id: 'b2',
      dim: 'brand',
      deep: true,
      type: 'single',
      plabel: '设备生态',
      title: '你现在的设备生态是？',
      hint: '生态会直接影响换机后的顺手程度。',
      options: [
        { k: 'apple', emoji: '🍎', label: '苹果全家桶', note: '手机、平板、手表' },
        { k: 'huawei', emoji: '🌸', label: '华为鸿蒙生态' },
        { k: 'mi', emoji: '🏠', label: '小米智能家居' },
        { k: 'none', emoji: '🤍', label: '没有生态绑定' }
      ]
    },
    {
      id: 'b3',
      dim: 'brand',
      deep: true,
      type: 'single',
      plabel: '外观偏好',
      title: '外观上你更吃哪一款？',
      hint: '每天都要拿在手里，颜值真的很重要。',
      options: [
        { k: 'small', emoji: '🪶', label: '小屏轻薄，单手能握' },
        { k: 'big', emoji: '📺', label: '大屏追剧，看着爽' },
        { k: 'fold', emoji: '🪞', label: '折叠屏，打开有仪式感' },
        { k: 'curve', emoji: '🌊', label: '曲面屏，颜值优先' },
        { k: 'flat', emoji: '🔲', label: '直屏，实用不误触' }
      ]
    },

    /* ===== 视频 ===== */
    {
      id: 'v1',
      dim: 'video',
      deep: false,
      type: 'single',
      plabel: '常拍视频',
      title: '你最常拍哪种视频？',
      hint: '选你拍得最多的那一种。',
      options: [
        { k: 'vlog', emoji: '🤳', label: '自拍 vlog、口播' },
        { k: 'travel', emoji: '🏞️', label: '旅行、日常风景' },
        { k: 'concert', emoji: '🎤', label: '演唱会、远处舞台' },
        { k: 'pet', emoji: '🐾', label: '娃和宠物，抓拍多' },
        { k: 'rare', emoji: '🙈', label: '很少拍视频' }
      ]
    },
    {
      id: 'v2',
      dim: 'video',
      deep: true,
      type: 'multi',
      max: 2,
      plabel: '视频最在意',
      title: '拍视频，你最在意什么？',
      hint: '最多选 2 项，选最不能妥协的。',
      options: [
        { k: 'stabil', emoji: '🫧', label: '防抖稳，走着拍也不晃' },
        { k: 'zoom', emoji: '🔭', label: '长焦拉得近，拍舞台清楚' },
        { k: 'night', emoji: '🌃', label: '夜景干净，灯光不糊' },
        { k: 'ready', emoji: '📤', label: '直出就能发，懒得剪' },
        { k: 'cinema', emoji: '🎞️', label: '电影感、色彩好看' }
      ]
    },

    /* ===== 拍照 ===== */
    {
      id: 'c1',
      dim: 'photo',
      deep: false,
      type: 'multi',
      max: 2,
      plabel: '常拍题材',
      title: '你平时最爱拍什么？',
      hint: '最多选 2 项，选你发朋友圈最多的。',
      options: [
        { k: 'portrait', emoji: '👩', label: '人像、闺蜜合照' },
        { k: 'landscape', emoji: '🌄', label: '风景、旅行' },
        { k: 'food', emoji: '🍰', label: '美食、探店' },
        { k: 'night', emoji: '🌃', label: '夜景、氛围感' },
        { k: 'all', emoji: '📸', label: '什么都拍，记录生活' }
      ]
    },
    {
      id: 'c2',
      dim: 'photo',
      deep: false,
      type: 'single',
      plabel: '自拍频率',
      title: '自拍对你来说重要吗？',
      hint: '前摄的差距，比参数表上看起来大。',
      options: [
        { k: 'daily', emoji: '💗', label: '每天都要拍', note: '前摄必须能打' },
        { k: 'sometimes', emoji: '🙂', label: '偶尔拍，够用就行' },
        { k: 'rare', emoji: '🤍', label: '很少自拍' }
      ]
    },
    {
      id: 'c3',
      dim: 'photo',
      deep: true,
      type: 'single',
      plabel: '长焦使用',
      title: '你会常用长焦吗？',
      hint: '长焦拍人像、拍舞台、拍远处都很好用。',
      options: [
        { k: 'often', emoji: '🔭', label: '经常，拍远景 / 演唱会' },
        { k: 'sometimes', emoji: '👌', label: '偶尔用，有更好' },
        { k: 'main', emoji: '📷', label: '基本只用主摄' },
        { k: 'ultrawide', emoji: '🌈', label: '更喜欢超广角' }
      ]
    },
    {
      id: 'c4',
      dim: 'photo',
      deep: true,
      type: 'single',
      plabel: '照片风格',
      title: '照片你更喜欢什么风格？',
      hint: '直出好看，还是留给自己修图的空间？',
      options: [
        { k: 'ready', emoji: '✨', label: '直出好看，懒得修' },
        { k: 'edit', emoji: '🖌️', label: '喜欢自己精修' },
        { k: 'film', emoji: '🎞️', label: '胶片、复古滤镜' },
        { k: 'natural', emoji: '🌿', label: '真实自然就好' }
      ]
    },

    /* ===== 听歌 ===== */
    {
      id: 'a1',
      dim: 'audio',
      deep: false,
      type: 'single',
      plabel: '听歌方式',
      title: '你平时怎么听歌？',
      hint: '外放和耳机，考验的硬件不一样。',
      options: [
        { k: 'bt', emoji: '🎧', label: '蓝牙耳机为主' },
        { k: 'wired', emoji: '🔌', label: '有线耳机，稍微烧一点' },
        { k: 'speaker', emoji: '🔊', label: '手机外放，洗澡也在放' },
        { k: 'rare', emoji: '🤫', label: '很少听歌' }
      ]
    },
    {
      id: 'a2',
      dim: 'audio',
      deep: true,
      type: 'single',
      plabel: '听歌场景',
      title: '听歌最多的场景是？',
      hint: '通勤党最该在意降噪和连接稳定性。',
      options: [
        { k: 'commute', emoji: '🚇', label: '通勤地铁，要降噪' },
        { k: 'home', emoji: '🏠', label: '在家外放' },
        { k: 'karaoke', emoji: '🎤', label: 'K 歌、录歌' },
        { k: 'game', emoji: '🎮', label: '打游戏听声辨位' }
      ]
    },

    /* ===== 打游戏 ===== */
    {
      id: 'g1',
      dim: 'gaming',
      deep: false,
      type: 'single',
      plabel: '常玩游戏',
      title: '你主要玩什么游戏？',
      hint: '不同游戏，对性能的要求差很多。',
      options: [
        { k: 'moba', emoji: '⚔️', label: '王者、和平精英' },
        { k: 'openworld', emoji: '🐉', label: '原神、星铁、鸣潮' },
        { k: 'casual', emoji: '🍬', label: '消消乐等休闲小游戏' },
        { k: 'none', emoji: '🎲', label: '基本不玩游戏' }
      ]
    },
    {
      id: 'g2',
      dim: 'gaming',
      deep: true,
      type: 'single',
      plabel: '游戏强度',
      title: '游戏强度大概是？',
      hint: '按你玩得最猛的那段时间算。',
      options: [
        { k: 'lt1', emoji: '⏱️', label: '每天 1 小时内' },
        { k: '1to3', emoji: '🕹️', label: '1–3 小时' },
        { k: 'gt3', emoji: '🔥', label: '3 小时以上' }
      ]
    },
    {
      id: 'g3',
      dim: 'gaming',
      deep: true,
      type: 'single',
      plabel: '游戏最怕',
      title: '打游戏最怕遇到什么？',
      hint: '选你最不能忍的那一个。',
      options: [
        { k: 'heat', emoji: '🌡️', label: '发热烫手' },
        { k: 'fps', emoji: '📉', label: '掉帧卡顿' },
        { k: 'battery', emoji: '🪫', label: '续航崩得快' },
        { k: 'screen', emoji: '📱', label: '屏幕太小' }
      ]
    },

    /* ===== 通用 ===== */
    {
      id: 'u1',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '手感偏好',
      title: '手机拿在手里的感觉，你更想要？',
      hint: '重量和尺寸，是最容易被参数表忽略的体验。',
      options: [
        { k: 'small', emoji: '🪶', label: '越小越轻越好' },
        { k: 'medium', emoji: '⚖️', label: '适中就好' },
        { k: 'big', emoji: '📺', label: '大屏追剧，重一点无所谓' }
      ]
    },
    {
      id: 'u2',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '续航底线',
      title: '续航你的底线是？',
      hint: '一天几充，直接决定幸福感。',
      options: [
        { k: 'oneday', emoji: '🔋', label: '一天一充就够' },
        { k: 'twoday', emoji: '🔌', label: '必须撑到第二天' },
        { k: 'fast', emoji: '⚡', label: '充得快就行' }
      ]
    },
    {
      id: 'u3',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '系统',
      title: '系统你习惯用？',
      hint: '换系统是最大的迁移成本。',
      options: [
        { k: 'ios', emoji: '🍎', label: 'iOS' },
        { k: 'android', emoji: '🤖', label: '安卓' },
        { k: 'harmony', emoji: '🌸', label: '鸿蒙' },
        { k: 'any', emoji: '🤍', label: '都可以，愿意尝试' }
      ]
    },
    {
      id: 'u4',
      dim: 'universal',
      deep: false,
      type: 'multi',
      max: 4,
      plabel: '必须有',
      title: '这些功能里，哪些是必须有的？',
      hint: '最多选 4 项；没有特别要求就点下面的「跳过」。',
      skipLabel: '没有特别要求，跳过',
      options: [
        { k: 'nfc', emoji: '💳', label: 'NFC，刷门禁公交' },
        { k: 'ir', emoji: '📡', label: '红外遥控' },
        { k: 'ip68', emoji: '💧', label: 'IP68 防水' },
        { k: 'wireless', emoji: '🔋', label: '无线充电' },
        { k: 'tele', emoji: '🔭', label: '长焦镜头' },
        { k: 'satellite', emoji: '🛰️', label: '卫星通信' },
        { k: 'jack', emoji: '🎧', label: '3.5mm 耳机孔' },
        { k: 'dual', emoji: '📶', label: '双卡双待' }
      ]
    },
    {
      id: 'u5',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '最忍不了',
      title: '最忍不了手机的哪个毛病？',
      hint: '这一条会写进 AI 的分析，帮它排雷。',
      options: [
        { k: 'heat', emoji: '🌡️', label: '发热' },
        { k: 'lag', emoji: '🐌', label: '卡顿' },
        { k: 'photo', emoji: '📷', label: '拍照糊' },
        { k: 'battery', emoji: '🪫', label: '续航差' },
        { k: 'heavy', emoji: '🏋️', label: '太重' },
        { k: 'ads', emoji: '📢', label: '系统广告多' },
        { k: 'signal', emoji: '📶', label: '信号差' }
      ]
    },
    {
      id: 'u6',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '存储',
      title: '存储你打算选多大？',
      hint: '照片视频多，建议 512GB 起。',
      options: [
        { k: '256', emoji: '💾', label: '256GB' },
        { k: '512', emoji: '🗂️', label: '512GB' },
        { k: '1t', emoji: '📦', label: '1TB' },
        { k: 'unsure', emoji: '🤷', label: '不清楚，听推荐' }
      ]
    },
    {
      id: 'u7',
      dim: 'universal',
      deep: false,
      type: 'single',
      plabel: '换机时间',
      title: '打算什么时候换？',
      hint: '不着急的话，等大促会更划算。',
      options: [
        { k: 'now', emoji: '🛒', label: '现在就买' },
        { k: 'month', emoji: '📅', label: '一个月内' },
        { k: 'sale', emoji: '🎉', label: '等大促' },
        { k: 'new', emoji: '⏳', label: '等新款发布' }
      ]
    }
  ];

  /* ---------- 示例报告 ---------- */
  const SAMPLE = {
    rankOrder: ['photo', 'video', 'price', 'brand', 'audio', 'gaming'],
    answers: {
      p1: '4k55',
      p2: 'new',
      p3: '2y',
      b1: 'none',
      b2: 'none',
      b3: 'small',
      v1: 'travel',
      v2: ['stabil', 'ready'],
      c1: ['portrait', 'night'],
      c2: 'daily',
      c3: 'sometimes',
      c4: 'ready',
      a1: 'bt',
      a2: 'commute',
      g1: 'none',
      g2: 'lt1',
      g3: 'heat',
      u1: 'small',
      u2: 'oneday',
      u3: 'any',
      u4: ['nfc', 'ip68'],
      u5: 'heavy',
      u6: '512',
      u7: 'month'
    },
    aiText: [
      '你是一个拍照和颜值优先、预算卡在 5500 以内、又想要轻一点的女生，最适合你的不是参数最猛的，而是影像和手感最均衡的。',
      '',
      '【主推1】vivo X200 Pro mini｜12GB+256GB｜参考价 4699 元',
      '优点：蔡司影像拍人像和夜景都很稳，直出就能发；6.31 英寸小直屏，单手拿着不累；天玑 9400 性能够用，续航也不拖后腿。',
      '缺点：长焦素质不如大杯旗舰；外放音质一般。',
      '适合：爱拍照、爱记录生活，又不想拿半斤砖头的人。',
      '',
      '【主推2】OPPO Find X8｜12GB+256GB｜参考价 4199 元',
      '优点：哈苏人像风格讨喜，抓拍成功率高；机身 7.85mm，配色很女生；ColorOS 流畅，续航扎实。',
      '缺点：屏幕护眼调光一般；游戏极限帧率不如专业电竞机。',
      '适合：想要轻薄直屏、拍照好看、日常用着省心的人。',
      '',
      '【备选1】小米15｜12GB+256GB｜参考价 4499 元',
      '优点：小屏旗舰里性能和手感最均衡，徕卡直出有氛围感。',
      '缺点：自拍偏真实，喜欢磨皮的可能要适应；机身略重。',
      '适合：想要小屏 + 性能 + 拍照都兼顾的人。',
      '',
      '【备选2】iPhone 16｜128GB｜参考价 4999 元',
      '优点：视频防抖和色彩依然是第一梯队，系统省心。',
      '缺点：128GB 不够用，充电慢，长焦缺失。',
      '适合：已经在苹果生态里、主要拍视频的人。',
      '',
      '【备选3】荣耀 Magic7｜12GB+256GB｜参考价 4499 元',
      '优点：屏幕护眼，AI 抓拍好玩，信号稳。',
      '缺点：影像风格偏浓，重量不轻。',
      '适合：看重屏幕和续航、偶尔拍娃拍宠物的人。',
      '',
      '【最终建议】想要拍照和手感优先，闭眼选 vivo X200 Pro mini；想要更便宜、更轻薄，选 OPPO Find X8。',
      '【避坑】别为了「参数更强」加钱上大杯，你的使用场景里，重量和直出色彩比跑分更重要。'
    ].join('\n')
  };

  return {
    DIMS: DIMS,
    SECTION_INTROS: SECTION_INTROS,
    QUESTIONS: QUESTIONS,
    SAMPLE: SAMPLE,
    BASE_WEIGHTS: [28, 23, 19, 15, 10, 5],
    MAX_QUESTIONS: 30
  };
});
