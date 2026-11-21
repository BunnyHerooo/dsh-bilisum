/** Read-only account library. Cookies never leave the Host. */
const API = 'https://api.bilibili.com';
const PAGE_SIZE = 20;
export class AccountError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function pageNumber(value) {
  const page = Number(value ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    throw new AccountError('BAD_REQUEST', '页码不合法。');
  }
  return page;
}
function video(item, favorite) {
  const cover = String(item.cover ?? item.pic ?? '');
  return {
    bvid: String(item.bvid ?? ''),
    title: String(item.title ?? '').replace(/<[^>]*>/g, ''),
    up: String(item.upper?.name ?? item.owner?.name ?? ''),
    duration: Number(item.duration) || 0,
    cover: /^(https?:)?\/\//.test(cover) ? cover.replace(/^\/\//, 'https://') : '',
    pubdate: Number(item.pubtime ?? item.pubdate) || 0,
    // Non-video favorites and deleted resources cannot enter the download queue.
    usable: (!favorite || item.type === undefined || item.type === 2)
      && !['已失效视频', '视频已失效'].includes(item.title),
  };
}

export function createAccountLibrary({ readCredential, navProbe, fetchImpl = fetch, userAgent }) {
  return async function accountLibrary({ action = 'folders', folderId, page: rawPage } = {}) {
    if (!['folders', 'favorites', 'watchlater'].includes(action)) {
      throw new AccountError('BAD_REQUEST', '未知账号列表类型。');
    }
    const page = pageNumber(rawPage);
    if (action === 'favorites' && !/^[1-9]\d{0,19}$/.test(String(folderId ?? ''))) {
      throw new AccountError('BAD_REQUEST', '请选择收藏夹。');
    }
    const cred = await readCredential();
    if (!cred.sessdata) throw new AccountError('LOGIN_REQUIRED', '请先扫码登录 B站账号。');
    const nav = await navProbe(cred.sessdata);
    if (nav.valid === false) throw new AccountError('LOGIN_REQUIRED', '登录已失效，请重新扫码登录。');
    if (nav.valid !== true || !nav.mid) {
      throw new AccountError('AUTH_UNVERIFIED', '暂时无法确认登录状态，请稍后重试。');
    }
    const account = { mid: String(nav.mid), uname: nav.uname || cred.uname || String(nav.mid) };
    // A callback URL can supply decoded SESSDATA; encode cookie delimiters once.
    const cookieValue = (value) => {
      try { return encodeURIComponent(decodeURIComponent(value)); }
      catch { return encodeURIComponent(value); }
    };
    const cookie = [`SESSDATA=${cookieValue(cred.sessdata)}`];
    if (cred.biliJct) cookie.push(`bili_jct=${cookieValue(cred.biliJct)}`);
    if (cred.dedeuserid) cookie.push(`DedeUserID=${cookieValue(cred.dedeuserid)}`);
    async function get(endpoint, params = {}) {
      const url = new URL(endpoint, API);
      url.search = new URLSearchParams(params).toString();
      let response, payload;
      try {
        response = await fetchImpl(url, {
          headers: { 'user-agent': userAgent, referer: 'https://www.bilibili.com/', cookie: cookie.join('; ') },
          signal: AbortSignal.timeout(10000), redirect: 'error',
        });
        if (!response.ok) throw new AccountError('UPSTREAM_ERROR', `B站接口返回 HTTP ${response.status}，请稍后重试。`);
        payload = await response.json();
      } catch (error) {
        if (error instanceof AccountError) throw error;
        throw new AccountError('NETWORK_ERROR', '读取 B站账号列表超时或网络异常，请重试。');
      }
      if (payload.code === -101) throw new AccountError('LOGIN_REQUIRED', 'B站返回未登录，请重新扫码登录。');
      if (payload.code !== 0) {
        throw new AccountError('UPSTREAM_ERROR', payload.code === -412
          ? 'B站暂时限制访问，请稍后重试。' : `读取账号列表失败（B站错误码 ${Number(payload.code) || '未知'}）。`);
      }
      return payload.data ?? {};
    }
    const folderList = async () => {
      const data = await get('/x/v3/fav/folder/created/list-all', { up_mid: account.mid, type: '2' });
      return Array.isArray(data.list) ? data.list : [];
    };
    let result;
    if (action === 'folders') {
      const list = await folderList();
      result = { folders: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(item => ({
        id: String(item.id), title: String(item.title ?? ''), count: Number(item.media_count) || 0,
      })), hasMore: page * PAGE_SIZE < list.length };
    } else {
      let list, hasMore;
      if (action === 'favorites') {
        // Do not accept arbitrary folder ids: this view is only the signed-in user's library.
        const folders = await folderList();
        if (!folders.some(item => String(item.id) === String(folderId))) {
          throw new AccountError('BAD_REQUEST', '该收藏夹不属于当前账号或已被删除，请刷新列表。');
        }
        const data = await get('/x/v3/fav/resource/list', {
          media_id: String(folderId), pn: String(page), ps: String(PAGE_SIZE), order: 'mtime', type: '0', tid: '0', platform: 'web',
        });
        list = Array.isArray(data.medias) ? data.medias : [];
        hasMore = data.has_more === true || data.has_more === 1;
      } else {
        const data = await get('/x/v2/history/toview');
        const all = Array.isArray(data.list) ? data.list : [];
        list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        hasMore = page * PAGE_SIZE < all.length;
      }
      const mapped = list.map(item => video(item, action === 'favorites'));
      const items = mapped.filter(item => item.usable && /^BV[0-9A-Za-z]{10}$/.test(item.bvid))
        .map(({ usable, ...item }) => item);
      result = { items, hasMore, skipped: list.length - items.length };
    }
    if ((await readCredential()).sessdata !== cred.sessdata) {
      throw new AccountError('ACCOUNT_CHANGED', '登录账号已变化，请重新加载列表。');
    }
    return { ok: true, account, page, ...result };
  };
}
