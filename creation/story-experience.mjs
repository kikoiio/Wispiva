import { loadModelConfig } from '../model/config.mjs';
import { callModel } from '../model/model-client.mjs';
import { exists, readJSON, writeJSONAtomic } from '../storage/files.mjs';

const places = [
  ['baker-street', '贝克街', ['贝克街', 'baker street']],
  ['sitting-room', '221B 会客室', ['会客室', '起居室', '221b', '福尔摩斯的家']],
  ['coburg-square', '萨克斯·科堡广场', ['科堡广场', '科堡', '广场', 'coburg']],
  ['pawnshop', '威尔逊的当铺', ['当铺', '典当', 'pawnshop']],
  ['pawn-cellar', '当铺地下室', ['当铺地下室', '当铺地窖', '摄影暗房', '地下室']],
  ['fleet-street', '舰队街', ['舰队街', 'fleet street']],
  ['pope-court', '蒲柏巷', ['蒲柏巷', '蒲柏院', '教皇巷', '波普法院', 'pope court', 'pope']],
  ['league-office', '红发会办公室', ['红发会办公室', '办公室', '抄写间', '红发会']],
  ['bank-vault', '银行金库', ['银行金库', '银行地下室', '金库', '银行地窖', '黄金', 'vault']],
  ['bank', '城市与郊区银行', ['银行', 'bank']],
  ['tunnel', '地下通道', ['地下通道', '地道', '隧道', '通道', 'tunnel']],
  ['commercial-street', '繁忙商业街', ['繁忙商业街', '商业街', '银行街']],
  ['mortimer-tobacconist', '莫蒂默烟草店', ['莫蒂默', '烟草店', '烟草铺', 'mortimer']],
  ['newspaper-shop', '报摊', ['小报摊', '报摊', '报纸店']],
  ['music-hall', '圣詹姆斯音乐厅', ['音乐厅', '音乐会', '圣詹姆斯', 'concert']],
  ['restaurant', '素食餐厅', ['素食', '餐厅', '吃饭', 'restaurant']],
  ['carriage-depot', '麦克法兰马车厂', ['麦克法兰', '马车厂', '马车工坊']],
  ['king-edward', '爱德华国王街', ['爱德华', '假地址', 'king edward']],
  ['knee-cap-factory', '护膝工厂', ['护膝工厂', '护具厂', '护膝', '人工膝盖']],
  ['baker-underground', '贝克街地铁站', ['贝克街地铁站', '贝克街站', 'baker street station']],
  ['aldersgate', 'Aldersgate 地铁站', ['aldersgate', '奥尔德斯盖特', '奥尔德斯门', '阿尔德斯盖特', '地铁站']],
  ['oxford-street', '牛津街', ['牛津街', 'oxford street']],
  ['the-park', '公园', ['公园', '花园散步']],
  ['london-streets', '伦敦街道', ['伦敦街道', '街上走走', '伦敦街头']],
];
const placeMap = new Map(places.map(([id, name, aliases]) => [id, { id, name, aliases }]));
const chapters = new Set(['league', 'investigation', 'heist', 'aftermath']);
const storyFacts = `原作：阿瑟·柯南·道尔《红发会》。这是依照小说制作的体素世界，贝克街、西区、舰队街和伦敦城分处不同街区。街区距离经过压缩，周边街巷和建筑陈设是场景设计，不是历史测绘。
原作中的福尔摩斯和华生乘地铁到Aldersgate，再步行去科堡广场。夜里华生穿过公园、牛津街来到贝克街，众人乘马车穿过许多煤气灯街道去银行。可以查看贝克街地铁站、Aldersgate站、牛津街和公园；周边街道可以步行。地铁两座车站是分别制作的场景，站间路线用于切换地点，未模拟列车运行。
地点：贝克街221B楼上的会客室；伦敦城附近萨克斯·科堡广场的威尔逊当铺及其地下室；舰队街蒲柏巷7号的红发会办公室；当铺背面紧邻、朝向繁忙商业街的城市与郊区银行及地下金库；当铺地下室到银行金库的挖掘通道；圣詹姆斯音乐厅；银行街的素食餐厅、莫蒂默烟草铺、报摊；爱德华国王街17号护膝工厂是邓肯·罗斯留下的假地址。
广场是一圈破旧的两层砖房，中央小花园有生锈栏杆和稀疏灌木。当铺的门口有三个镀金球。背后的街道店铺顺序为莫蒂默烟草铺、报摊、银行、素食餐厅、麦克法兰马车厂。
人物：夏洛克·福尔摩斯、华生医生、红发当铺老板杰贝兹·威尔逊、伙计文森特·斯波尔丁（真名约翰·克莱）、邓肯·罗斯（克莱的同伙阿奇）、警探彼得·琼斯、银行董事梅里韦瑟。
红发会以每周四英镑、每天上午十点至下午两点抄写《大英百科全书》的工作为诱饵，要求威尔逊不得离开办公室。他自备笔、墨水和纸，从A卷抄起。办公室只有一张桌子、两把椅子。1890年10月9日办公室贴出“红发会已解散”。
克莱主动以半薪当伙计，借口摄影频繁下地窖。磨损、沾污的裤子膝部是挖掘线索。福尔摩斯敲击人行道判断地窖方向，绕街角后发现银行紧邻当铺背面。
福尔摩斯与华生听了圣詹姆斯音乐厅的萨拉萨蒂演奏。夜间福尔摩斯、华生、琼斯和梅里韦瑟从银行侧门、走廊、石阶和铁门进入金库，在木箱后熄灯守候。银行有从法国借来的三万枚拿破仑金币，木箱里装的是金币，不是债券。克莱由地板石板下探出，同伙跟随，两人被捕。结尾福尔摩斯在贝克街向华生解释推理。
四个时段是预先编排的场面：红发会工作时段；调查；银行之夜；破案之后。切换时段用于查看小说场面。没有持续自主行动或通用世界创建。`;

function localNavigation(message) {
  const normalized = message.toLowerCase().replace(/[。！!？?]/g, '').trim();
  const candidates = places.flatMap(([id, name, aliases]) => aliases.map(alias => ({ id, name, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const destination = candidates.find(item => normalized.includes(item.alias));
  if (!destination) return null;
  const request = /去|带我|前往|回到|参观|走进|打开|看一下|看看|看下|看一眼/.test(normalized) ||
    normalized === destination.alias;
  if (!request || /为什么|为何|怎么回事|是什么|不能|看不到/.test(normalized)) return null;
  return { focus: destination.id, content: `到${destination.name}了。` };
}
function localChapter(message) {
  if (!/切换|看一下|看看|带我|回到|进入/.test(message)) return null;
  for (const [id, pattern, name] of [
    ['aftermath', /破案之后|破案后|结案|结尾/, '破案之后'],
    ['heist', /银行之夜|夜晚|夜间|晚上|抓捕|银行劫案/, '银行之夜'],
    ['investigation', /调查|下午/, '调查时段'],
    ['league', /红发会工作|抄写|上午|工作时段/, '红发会工作时段'],
  ]) if (pattern.test(message)) return { chapter: id, content: `已切换到${name}。` };
  return null;
}

export function createStoryExperience({ stateFile, configLoader = loadModelConfig, fetchImpl = globalThis.fetch,
  requestTimeoutMs = 90_000, invokeModel = callModel } = {}) {
  let messages = [], chapter = 'investigation', pending = null, closed = false;
  if (stateFile && exists(stateFile)) {
    try {
      const saved = readJSON(stateFile);
      if (chapters.has(saved.chapter)) chapter = saved.chapter;
      if (Array.isArray(saved.messages)) messages = saved.messages.filter(item =>
        ['user', 'assistant'].includes(item?.role) && typeof item.content === 'string' && item.content.length <= 8000).slice(-80);
    } catch { /* A chat save cannot prevent opening the authored world. */ }
  }
  const commit = (nextMessages, nextChapter = chapter) => {
    const bounded = nextMessages.slice(-80);
    if (stateFile) writeJSONAtomic(stateFile, { version: 1, chapter: nextChapter, messages: bounded }, { mkdir: true });
    messages = bounded; chapter = nextChapter;
  };
  const configured = () => { try { configLoader(); return true; } catch { return false; } };
  const state = () => ({ ok: true, title: '红发会', chapter, messages: structuredClone(messages), busy: Boolean(pending), model: { configured: configured() } });
  const result = (ok, message, extra = {}) => ({ ok, ...(message ? { message } : {}), messages: structuredClone(messages), ...extra });
  async function chat({ message, placeId, chapter: selectedChapter } = {}, { signal, onProgress } = {}) {
    if (closed) return result(false, '服务已关闭，请重新连接。');
    if (pending) return result(false, '上一条回复还在进行。');
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) return result(false, '请输入一条不超过 4000 字的消息。');
    if (placeId && !placeMap.has(placeId) || selectedChapter && !chapters.has(selectedChapter)) return result(false, '这个地点或时段不存在，请重新选择。');
    if (signal?.aborted) return result(false, '已停止回复。', { reason: 'cancelled' });
    message = message.trim();
    if (selectedChapter) chapter = selectedChapter;
    const navigation = localNavigation(message), time = localChapter(message);
    if (navigation || time) {
      commit([...messages, { role: 'user', content: message }, { role: 'assistant', content: [time?.content, navigation?.content].filter(Boolean).join('') }], time?.chapter ?? chapter);
      return result(true, null, { ...(navigation ? { focus: navigation.focus } : {}), ...(time ? { chapter } : {}) });
    }
    let config;
    try { config = configLoader(); }
    catch { return result(false, '自由对话需要配置模型。现在可以直接说“去当铺”或用地点菜单探索。', { reason: 'model-unconfigured' }); }
    const controller = new AbortController(); pending = controller;
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
    try {
      commit([...messages, { role: 'user', content: message }]);
      const response = await invokeModel({ llm: { ...config.llm, timeoutMs: config.llm.timeoutMs ?? requestTimeoutMs, maxOutputTokens: 1200 },
        messages: [{ role: 'system', content: `你是《红发会》世界的中文对话向导。回复简短、自然，用普通聊天的语气。根据下面的原文事实回答，场景陈设与原作事实要区分；没有依据就直说。用户没问剧情时不要主动剧透。当前地点：${placeMap.get(placeId)?.name ?? '科堡广场'}；当前时段：${chapter}。这是预制故事世界，只能查看地点和时段，不能创建或修改建筑；不要声称已经建造或改变世界。可以建议用户说“去某地点”来查看。
${storyFacts}` }, ...messages.slice(-20)],
        fetchImpl, signal: controller.signal, jsonMode: false,
        onProgress: event => onProgress?.({ phase: event.phase, preview: event.preview || '', elapsedMs: event.elapsedMs }),
      });
      if (controller.signal.aborted) return result(false, '已停止回复。', { reason: 'cancelled' });
      if (!response.ok || typeof response.content !== 'string' || !response.content.trim()) {
        return result(false, response.audit?.error?.code === 'timeout' ? '回复超时，请重试。' : '这条回复没有完成，请重试。');
      }
      commit([...messages, { role: 'assistant', content: response.content.trim().slice(0, 8000) }]);
      return result(true);
    } catch {
      return result(false, controller.signal.aborted ? '已停止回复。' : '这条回复没有完成，请重试。', controller.signal.aborted ? { reason: 'cancelled' } : {});
    } finally {
      signal?.removeEventListener('abort', cancel); if (pending === controller) pending = null;
    }
  }
  return { state, chat, cancel() { const running = Boolean(pending); pending?.abort(); return result(true, running ? '已停止回复。' : null); },
    close() { closed = true; pending?.abort(); },
  };
}
