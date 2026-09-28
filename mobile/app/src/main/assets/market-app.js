/* Lightweight screen controller. Each bottom tab keeps its own WebView/history. */
(() => {
  const api = window.KimgosuApi;
  const root = document.getElementById('app');
  const page = document.body.dataset.page;
  const params = new URLSearchParams(location.search);
  const me = api.profile();
  const fallbackCategories = [
    ['design_development','디자인/개발'],['video_editing','영상편집'],
    ['translation','번역'],['legal','법률'],['cleaning_interior','청소/인테리어'],
    ['pets','반려'],['hair_beauty','헤어/미용']];
  let categories = fallbackCategories.map(([code,displayName]) => ({code,displayName}));
  const e = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fmt = value => value == null ? '협의' : `${Number(value).toLocaleString('ko-KR')}원`;
  const link = (file, options={}) => file + (Object.keys(options).length ? '?' +
    new URLSearchParams(options).toString() : '');
  const header = (title, back=false, action='') => `<header class="page-head">${back ?
    '<a class="back-link" href="kimgosu://back">‹ 뒤로</a>' : `<h1>${e(title)}</h1>`}${
    back ? `<strong>${e(title)}</strong>` : ''}${action}</header>`;
  const error = message => `<div class="error" role="alert">${e(message)}</div>`;
  const empty = (title, message, cta='', href='') => `<div class="empty"><h2>${e(title)}</h2><p>${e(message)}</p>${
    cta ? `<a class="primary" href="${e(href)}">${e(cta)}</a>` : ''}</div>`;
  const card = (item, kind) => `<a class="card" href="${link('detail.html',{kind,id:item.id})}">
    <span class="pill ${kind === 'quote' ? 'mint' : ''}">${e(categoryName(item.categoryCode))}</span>
    <div class="card-title" style="margin-top:9px">${e(item.title)}</div>
    <div class="card-sub">${e(item.description).slice(0,110)}</div>
    <div class="card-meta"><span>${item.mode === 'remote' ? '비대면' : e(item.regionName || '대면')}</span>
    <strong class="card-price">${fmt(kind === 'quote' ? item.budgetMax : item.priceFrom)}</strong></div></a>`;
  const categoryName = code => categories.find(x => x.code === code)?.displayName || code || '전체';
  const categoryOptions = selected => categories.map(x => `<option value="${e(x.code)}"${x.code === selected ? ' selected' : ''}>${e(x.displayName)}</option>`).join('');
  function showError(message) { root.insertAdjacentHTML('beforeend', error(message)); }
  async function loadCategories() {
    try { categories = await api.request('GET','/api/v1/catalog/home-categories'); }
    catch (_) { /* bundled names preserve quick first render */ }
  }
  async function list(kind, query='', category='') {
    const path = kind === 'quote' ? '/api/v1/quote-requests' : '/api/v1/services';
    const search = new URLSearchParams();
    if (query) search.set('q',query);
    if (category) search.set('categoryCode',category);
    if (me.regions?.length) {
      search.set('regions',me.regions.join(','));
      search.set('includeRemote',String(me.includeRemote !== false));
    }
    return (await api.request('GET',path + (search.size ? '?' + search : ''))).items;
  }
  function tabs(current) { return `<div class="segmented"><button data-kind="service" class="${current === 'service' ? 'active' : ''}">전문가 서비스</button><button data-kind="quote" class="${current === 'quote' ? 'active' : ''}">견적 요청</button></div>`; }
  function categoryChips(selected='') { return `<div class="chips"><button class="chip ${!selected ? 'active':''}" data-category="">전체</button>${categories.map(x =>
    `<button class="chip ${selected === x.code ? 'active':''}" data-category="${e(x.code)}">${e(x.displayName)}</button>`).join('')}</div>`; }

  async function renderSearch(initial=false) {
    let kind = document.querySelector('[data-kind].active')?.dataset.kind ?? params.get('kind') ?? 'service';
    let category = document.querySelector('[data-category].active')?.dataset.category ?? params.get('categoryCode') ?? '';
    let query = document.getElementById('query')?.value.trim() ?? params.get('q') ?? '';
    root.innerHTML = header(initial ? '검색' : '서비스 목록', !initial) +
      `<h2 class="lead">${initial ? '어떤 도움이 필요하세요?' : e(categoryName(category))}</h2>
      <p class="sub">우리 동네 전문가의 서비스와 견적 요청을 살펴보세요.</p>
      <form class="search-field" id="searchForm"><span>⌕</span><input id="query" placeholder="서비스·전문가 검색" value="${e(query)}"><button>검색</button></form>
      ${tabs(kind)}${categoryChips(category)}<div id="results">${empty('불러오는 중','잠시만 기다려 주세요.')}</div>`;
    root.querySelector('#searchForm').onsubmit = event => {event.preventDefault();renderSearch(initial)};
    root.querySelectorAll('[data-kind]').forEach(button => button.onclick = () => {
      root.querySelector('[data-kind].active')?.classList.remove('active');button.classList.add('active');renderSearch(initial);
    });
    root.querySelectorAll('[data-category]').forEach(button => button.onclick = () => {
      root.querySelector('[data-category].active')?.classList.remove('active');button.classList.add('active');renderSearch(initial);
    });
    try { const items = await list(kind,query,category);
      root.querySelector('#results').innerHTML = items.length ? items.map(x => card(x,kind)).join('') :
        empty('검색 결과가 없습니다','다른 분야나 검색어로 찾아보세요.');
    } catch (ex) {root.querySelector('#results').innerHTML = error(ex.message)}
  }

  function renderRegister() {
    const expert=me.expertEnabled && me.expertMode;
    root.innerHTML = header('등록') + `<span class="role-badge">${expert?'고수로 활동 중':'일반 이용 중'}</span>
      <h2 class="lead">${expert?'전문 서비스를 등록하세요':'필요한 일을 등록해보세요'}</h2>
      <p class="sub">${expert?'서비스를 소개하면 고객이 검색하고 문의할 수 있어요.':'요구사항을 올리면 맞는 고수가 제안을 보낼 수 있어요.'}</p>
      ${expert ? `<div class="hero-card"><h2>고수 서비스 등록</h2><p>제공 분야·가격·서비스 내용을 알려주세요.</p>
        <a class="primary" href="editor.html?kind=service">서비스 등록하기 →</a></div>
        <div class="card"><h2>일반 이용자로 견적 요청</h2><p class="card-sub">도움이 필요할 때는 일반 이용자로 요청할 수 있어요.</p>
        <a class="outline wide" href="editor.html?kind=quote">견적 등록하기</a></div>` :
        `<div class="hero-card"><h2>견적 요청하기</h2><p>작업 내용과 희망 예산을 알려주세요.</p>
        <a class="primary" href="editor.html?kind=quote">견적 등록하기 →</a></div>
        ${me.expertEnabled ? `<div class="card"><h2>고수로 서비스 등록</h2><p class="card-sub">고수 활동으로 전환하면 서비스를 관리할 수 있어요.</p>
        <button id="registerExpertSwitch" class="outline wide">고수 화면으로 전환</button></div>` : ''}`}`;
    root.querySelector('#registerExpertSwitch')?.addEventListener('click',()=>api.setMode('expert'));
  }

  async function renderEditor() {
    const kind = params.get('kind') === 'service' ? 'service' : 'quote';
    const editingId = params.get('id');
    if (kind === 'service' && !me.expertEnabled) {root.innerHTML = header('서비스 등록',true) + error('고수 계정만 서비스를 등록할 수 있습니다.');return;}
    root.innerHTML = header(kind === 'quote' ? '견적 등록' : '서비스 등록',true) +
      `<h1 class="lead">${kind === 'quote' ? '어떤 도움이 필요하세요?' : '어떤 서비스를 제공하나요?'}</h1>
      <p class="sub">필수 내용을 입력하면 바로 등록됩니다.</p>
      <form id="editor"><div class="form-group"><label>분야</label><select name="categoryCode">${categoryOptions(params.get('categoryCode'))}</select></div>
      <div class="form-group"><label>제목</label><input name="title" required minlength="2" maxlength="120" placeholder="서비스를 한 문장으로 설명해 주세요"></div>
      <div class="form-group"><label>상세 내용</label><textarea name="description" required minlength="10" maxlength="4000" placeholder="필요한 내용과 일정을 자세히 적어 주세요"></textarea></div>
      <div class="form-group"><label>진행 방식</label><select name="mode"><option value="remote">비대면</option><option value="onsite">대면</option></select></div>
      <div class="form-group" id="regionRow" hidden><label>서비스 지역</label><input name="regionName" maxlength="100" placeholder="예: 강남구"></div>
      <div class="form-group"><label>${kind === 'quote' ? '희망 예산 (원, 선택)' : '시작 가격 (원)'}</label><input name="amount" type="number" min="0" ${kind === 'service' ? 'required':''} placeholder="예: 50000"></div>
      <button class="primary wide">${kind === 'quote' ? '견적 등록하기' : '서비스 등록하기'}</button></form>`;
    const form = root.querySelector('#editor');
    const field = name => form.elements.namedItem(name);
    field('mode').onchange = () => {root.querySelector('#regionRow').hidden = field('mode').value !== 'onsite'};
    if (editingId) {
      try {const item=await api.request('GET',`/api/v1/${kind === 'service' ? 'services' : 'quote-requests'}/${encodeURIComponent(editingId)}`);
        if (!me.userId || item.ownerUserId !== me.userId) {
          root.innerHTML = header('수정 권한 없음',true) + error('작성자만 이 글을 수정할 수 있습니다.');
          return;
        }
        field('categoryCode').value=item.categoryCode;field('title').value=item.title;
        field('description').value=item.description;field('mode').value=item.mode;
        field('regionName').value=item.regionName||'';
        field('amount').value=(kind === 'service' ? item.priceFrom : item.budgetMax) ?? '';
        field('mode').onchange();
      }catch(ex){root.innerHTML = header('글을 불러올 수 없습니다',true) + error(ex.message);return}
    }
    form.onsubmit = async event => {event.preventDefault();
      const payload = {categoryCode:field('categoryCode').value,title:field('title').value,
        description:field('description').value,mode:field('mode').value,
        regionName:field('mode').value === 'onsite' ? field('regionName').value.trim() : null};
      if (kind === 'service') payload.priceFrom = Number(field('amount').value);
      else payload.budgetMax = field('amount').value ? Number(field('amount').value) : null;
      try {const base=kind === 'service' ? '/api/v1/services' : '/api/v1/quote-requests';
        const result = await api.request(editingId ? 'PUT' : 'POST',base+(editingId?'/'+encodeURIComponent(editingId):''),payload);
        location.href = link('detail.html',{kind,id:result.id});
      } catch(ex) {showError(ex.message)}
    };
  }

  async function renderDetail() {
    const kind = params.get('kind') === 'quote' ? 'quote' : 'service';
    const id = params.get('id');
    if (!id) {location.replace(link('listing.html',{categoryCode:params.get('category') || ''}));return;}
    root.innerHTML = header(kind === 'quote' ? '견적 상세' : '서비스 상세',true) + empty('불러오는 중','잠시만 기다려 주세요.');
    try {const item = await api.request('GET',`/api/v1/${kind === 'quote' ? 'quote-requests' : 'services'}/${encodeURIComponent(id)}`);
      const own = item.ownerUserId === me.userId;
      root.innerHTML = header(kind === 'quote' ? '견적 상세' : '서비스 상세',true) +
        `<span class="pill">${e(categoryName(item.categoryCode))}</span><h1 class="detail-title">${e(item.title)}</h1>
        <p class="sub">${item.mode === 'remote' ? '비대면' : '대면 · '+e(item.regionName)}</p>
        <div class="detail-amount">${fmt(kind === 'quote' ? item.budgetMax : item.priceFrom)}</div>
        <h2 class="section-title">상세 내용</h2><p class="detail-copy">${e(item.description)}</p><div class="actions" id="detailActions"></div>`;
      const actions = root.querySelector('#detailActions');
      if (own) actions.innerHTML = kind === 'quote' ?
        `<a class="outline wide" href="${link('editor.html',{kind,id})}">수정</a><button id="closeQuote" class="outline wide">견적 마감</button><a class="primary wide" href="${link('received.html',{id})}">받은 제안</a><button id="deleteResource" class="outline wide">삭제</button>` :
        `<a class="outline wide" href="${link('editor.html',{kind,id})}">수정</a><button class="outline wide" id="hideService">숨기기</button><button id="deleteResource" class="outline wide">삭제</button>`;
      else if (kind === 'service') actions.innerHTML = '<button class="outline wide" id="favorite">♡ 찜하기</button><button class="primary wide" id="inquire">문의하기</button>';
      else if (me.expertEnabled) actions.innerHTML = '<button class="primary wide" id="propose">제안하기</button>';
      if (root.querySelector('#closeQuote')) root.querySelector('#closeQuote').onclick = async () => {
        try {await api.request('POST',`/api/v1/quote-requests/${id}/close`,{});location.reload()} catch(ex){showError(ex.message)} };
      if (root.querySelector('#hideService')) root.querySelector('#hideService').onclick = async () => {
        try {await api.request('POST',`/api/v1/services/${id}/hide`,{});location.reload()} catch(ex){showError(ex.message)} };
      if (root.querySelector('#deleteResource')) root.querySelector('#deleteResource').onclick = async () => {
        if (!confirm('삭제하면 목록에서 사라집니다. 기존 채팅 기록은 유지됩니다. 삭제할까요?')) return;
        try {await api.request('DELETE',`/api/v1/${kind === 'quote' ? 'quote-requests' : 'services'}/${id}`);
          location.href = kind === 'quote' ? 'activity.html?section=quotes' : 'activity.html?section=services';
        } catch(ex){showError(ex.message)} };
      if (root.querySelector('#favorite')) root.querySelector('#favorite').onclick = async () => {
        try {await api.request('PUT',`/api/v1/services/${id}/favorite`,{});root.querySelector('#favorite').textContent='♥ 찜 완료'} catch(ex){showError(ex.message)} };
      if (root.querySelector('#inquire')) root.querySelector('#inquire').onclick = async () => {
        try {const room = await api.request('POST',`/api/v1/services/${id}/inquiries`,{});location.href=link('room.html',{id:room.chatRoomId})} catch(ex){showError(ex.message)} };
      if (root.querySelector('#propose')) root.querySelector('#propose').onclick = () => location.href=link('proposal.html',{id});
    } catch(ex) {root.innerHTML = header('상세',true) + error(ex.message)}
  }

  async function renderProposal() {
    const id=params.get('id');root.innerHTML=header('제안하기',true)+`<h1 class="lead">내 서비스로 제안하기</h1><p class="sub">같은 분야에 등록한 서비스를 선택해 견적 작성자에게 제안합니다.</p><div id="offerList"></div>`;
    try {const [quote, services] = await Promise.all([
      api.request('GET',`/api/v1/quote-requests/${encodeURIComponent(id)}`),
      api.request('GET','/api/v1/me/services')]);
      const eligible = services.items.filter(x => x.categoryCode === quote.categoryCode && x.status === 'active');
      root.querySelector('#offerList').innerHTML = eligible.length ? eligible.map(x =>
        `<button class="card" style="width:100%;text-align:left" data-service="${e(x.id)}"><strong>${e(x.title)}</strong><span class="card-meta">${fmt(x.priceFrom)} · 선택하기 →</span></button>`).join('') :
        empty('제안 가능한 서비스가 없습니다','같은 분야의 서비스를 먼저 등록해 주세요.','서비스 등록하기','editor.html?kind=service');
      root.querySelectorAll('[data-service]').forEach(button => button.onclick = async () => {
        try {const result=await api.request('POST',`/api/v1/quote-requests/${id}/proposals`,{serviceId:button.dataset.service});
          location.href=link('room.html',{id:result.chatRoomId});} catch(ex){showError(ex.message)} });
    } catch(ex){showError(ex.message)}
  }

  async function renderChats() {
    root.innerHTML=header('채팅')+`<h1 class="lead">대화 목록</h1><p class="sub">서비스 문의와 견적 제안을 한곳에서 확인하세요.</p><div id="rooms"></div><button id="moreRooms" class="outline wide" hidden>대화 더 보기</button>`;
    const rows=root.querySelector('#rooms');
    const more=root.querySelector('#moreRooms');
    let cursor=null;
    async function loadMore() {
      more.disabled=true;
      try {
        const path='/api/v1/chat/rooms?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):'');
        const data=await api.request('GET',path);
        if (!cursor && !data.items.length) rows.innerHTML=
          empty('아직 대화가 없습니다','마음에 드는 서비스를 찾고 고수에게 문의해 보세요.','서비스 둘러보기','kimgosu://tab/1');
        else rows.insertAdjacentHTML('beforeend',data.items.map(x =>
          `<a class="card" href="${link('room.html',{id:x.id})}"><span class="pill">${x.subjectType === 'service' ? '서비스 문의' : '견적 제안'}</span>
          <div class="card-title" style="margin-top:8px">${e(x.displayTitle || '대화 이어가기')}</div><div class="card-meta"><span>${e(x.lastMessageAt ? new Date(x.lastMessageAt).toLocaleString('ko-KR') : '새 대화')}</span><span>${x.unreadCount ? e(x.unreadCount)+'개 안 읽음' : '›'}</span></div></a>`).join(''));
        cursor=data.nextCursor;
        more.hidden=!cursor;
      } catch(ex) {showError(ex.message)}
      finally {more.disabled=false}
    }
    more.onclick=loadMore;
    await loadMore();
  }
  if(page==='chat') window.addEventListener('kimgosu-tab-visible',renderChats);

  function uid() {return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c => {
    const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3|8)).toString(16)})}
  async function renderRoom() {
    const id=params.get('id');root.innerHTML=header('대화방',true)+`<button id="olderMessages" class="outline wide" hidden>이전 대화 보기</button><div class="bubble-list" id="messages"></div>
      <div id="completion" class="completion"></div>
      <div id="pendingAttachments" class="pending-attachments" hidden></div>
      <form class="send-bar" id="send"><button type="button" id="attachFile" class="attach-button" aria-label="사진 또는 문서 첨부">＋</button><input name="message" maxlength="4000" placeholder="메시지를 입력하세요"><button type="submit">전송</button></form>`;
    const box=root.querySelector('#messages');const older=root.querySelector('#olderMessages');
    const pendingBox=root.querySelector('#pendingAttachments');
    let last=null, olderCursor=null, messages=[], completionStamp=null, pendingFiles=[];
    function paintPending(){
      pendingBox.hidden=!pendingFiles.length;
      pendingBox.innerHTML=pendingFiles.map((file,index)=>`<span class="pending-file">${e(file.filename)} <button type="button" data-index="${index}" aria-label="첨부 제거">×</button></span>`).join('');
      pendingBox.querySelectorAll('button').forEach(button=>button.onclick=async()=>{
        const [removed]=pendingFiles.splice(Number(button.dataset.index),1);paintPending();
        api.request('DELETE',`/api/v1/chat/attachments/${encodeURIComponent(removed.id)}`).catch(()=>{});
      });
    }
    api.request('GET',`/api/v1/chat/rooms/${encodeURIComponent(id)}`).then(room=>{
      root.querySelector('.page-head strong').textContent=room.displayTitle || '대화방';
    }).catch(()=>{});
    function mergeMessages(items) {
      const byId=new Map(messages.map(item=>[item.id,item]));
      items.forEach(item=>byId.set(item.id,item));
      messages=[...byId.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    }
    function paintMessages() {
      box.innerHTML=messages.length?messages.map(x=>`<div class="bubble ${x.senderUserId===me.userId?'mine':''}">${e(x.text)}${(x.attachments||[]).map(file=>`<button type="button" class="attached-file" data-id="${e(file.id)}" data-name="${e(file.filename)}">📎 ${e(file.filename)} · ${Math.ceil(file.byteSize/1024)}KB</button>`).join('')}</div>`).join(''):
        empty('새 대화입니다','첫 메시지를 보내보세요.');
      box.querySelectorAll('.attached-file').forEach(button=>button.onclick=()=>
        Promise.resolve(api.saveAttachment(button.dataset.id,button.dataset.name)).catch(ex=>showError(ex.message)));
      older.hidden=!olderCursor;
    }
    async function refreshCompletion(){try{
      const state=await api.request('GET',`/api/v1/chat/rooms/${id}/completion`);
      const stamp=JSON.stringify([state.myConfirmed,state.counterpartConfirmed,state.completed,state.myReviewed]);
      if(stamp===completionStamp)return;completionStamp=stamp;
      const panel=root.querySelector('#completion');
      if(state.completed) panel.innerHTML=state.myReviewed ? '<p>거래 완료 · 리뷰를 남겼습니다.</p>' :
        `<p>양측이 거래 완료를 확인했습니다.</p><form id="reviewForm"><label>리뷰 점수</label><select name="rating"><option value="5">5점</option><option value="4">4점</option><option value="3">3점</option><option value="2">2점</option><option value="1">1점</option></select><textarea name="body" required minlength="10" maxlength="1000" placeholder="거래 경험을 자세히 남겨 주세요"></textarea><button class="primary wide">리뷰 남기기</button></form>`;
      else panel.innerHTML=`<p>${state.myConfirmed?'내 확인 완료 · 상대방 확인을 기다립니다.':'거래가 완료되었다면 양측이 확인해 주세요.'}</p>${state.myConfirmed?'':'<button id="confirmCompletion" class="outline wide">거래 완료 확인</button>'}`;
      panel.querySelector('#confirmCompletion')?.addEventListener('click',async()=>{
        try{await api.request('POST',`/api/v1/chat/rooms/${id}/completion`,{});await refreshCompletion()}catch(ex){showError(ex.message)}});
      panel.querySelector('#reviewForm')?.addEventListener('submit',async event=>{
        event.preventDefault();const form=event.target;
        try{await api.request('POST',`/api/v1/chat/rooms/${id}/reviews`,{rating:Number(form.elements.namedItem('rating').value),body:form.elements.namedItem('body').value});await refreshCompletion()}catch(ex){showError(ex.message)}});
    }catch(ex){completionStamp=null;root.querySelector('#completion').innerHTML=error(ex.message)}}
    async function refresh(){try{const nearBottom=document.documentElement.scrollHeight-window.scrollY-window.innerHeight<120;
      const data=await api.request('GET',`/api/v1/chat/rooms/${encodeURIComponent(id)}/messages?limit=50`);
      const stamp=data.items.map(x=>x.id).join(',');if(stamp===last)return;last=stamp;
      mergeMessages(data.items);
      if(!olderCursor && data.nextCursor)olderCursor=data.nextCursor;
      paintMessages();if(nearBottom)window.scrollTo(0,document.body.scrollHeight);
      if(data.items.length) api.request('POST',`/api/v1/chat/rooms/${id}/read`,
        {throughMessageId:data.items[data.items.length-1].id}).catch(()=>{});
    }catch(ex){last=null;box.innerHTML=error(ex.message)}}
    older.onclick=async()=>{
      if(!olderCursor)return;
      older.disabled=true;
      const previousHeight=document.documentElement.scrollHeight, previousScroll=window.scrollY;
      try {
        const data=await api.request('GET',`/api/v1/chat/rooms/${encodeURIComponent(id)}/messages?limit=50&before=${encodeURIComponent(olderCursor)}`);
        mergeMessages(data.items);olderCursor=data.nextCursor;paintMessages();
        window.scrollTo(0,previousScroll+document.documentElement.scrollHeight-previousHeight);
      } catch(ex) {showError(ex.message)}
      finally {older.disabled=false}
    };
    root.querySelector('#attachFile').onclick=async event=>{
      if(pendingFiles.length>=5){showError('한 메시지에 최대 5개까지 첨부할 수 있습니다');return}
      const button=event.currentTarget;button.disabled=true;
      try{const file=await api.pickAttachment(id);pendingFiles.push(file);paintPending()}
      catch(ex){if(!/취소|선택하지/.test(ex.message))showError(ex.message)}
      finally{button.disabled=false}
    };
    root.querySelector('#send').onsubmit=async event=>{event.preventDefault();const form=event.target;
      const value=form.elements.namedItem('message').value.trim();if(!value&&!pendingFiles.length)return;
      const button=form.querySelector('button[type="submit"]');button.disabled=true;
      try{await api.request('POST',`/api/v1/chat/rooms/${id}/messages`,{clientMessageId:uid(),text:value,attachmentIds:pendingFiles.map(file=>file.id)});
        form.reset();pendingFiles=[];paintPending();await refresh()}
      catch(ex){showError(ex.message)}finally{button.disabled=false}};
    await refresh();await refreshCompletion();
    let timer=null, refreshing=false;
    async function tick() {
      if(refreshing)return;
      if(window.KimgosuNative && !window.KimgosuNative.isPageVisible())return;
      refreshing=true;
      try {await Promise.all([refresh(),refreshCompletion()])}
      finally {refreshing=false}
    }
    function startPolling() {if(timer)return;tick();timer=setInterval(tick,5000)}
    function stopPolling() {if(timer)clearInterval(timer);timer=null}
    window.addEventListener('kimgosu-tab-hidden',stopPolling);
    window.addEventListener('kimgosu-tab-visible',startPolling);
    window.addEventListener('pagehide',stopPolling,{once:true});
    startPolling();
  }

  function renderMy() {
    root.innerHTML=header('마이')+`<span class="role-badge">${me.expertMode?'고수로 활동 중':'일반 이용 중'}</span><div class="hero-card"><h2>${e(me.customerName || '게스트')}님</h2>
      <p>${me.expertEnabled?'고수 활동과 일반 이용을 전환할 수 있어요':'일반 이용자 계정'}</p></div>
      ${me.expertEnabled ? `<button id="modeSwitch" class="outline wide">${me.expertMode ? '일반 화면으로 전환' : '고수 화면으로 전환'}</button>` : ''}
      <h2 class="section-title">나의 활동</h2>
      <a class="list-row" href="activity.html?section=quotes"><strong>나의 견적 요청</strong><span>›</span></a>
      ${me.expertEnabled?'<a class="list-row" href="activity.html?section=services"><strong>나의 서비스</strong><span>›</span></a><a class="list-row" href="activity.html?section=proposals"><strong>보낸 제안</strong><span>›</span></a>':''}
      <a class="list-row" href="favorites.html"><strong>찜한 서비스</strong><span>›</span></a>
      <a class="list-row" href="kimgosu://tab/3"><strong>채팅</strong><span>›</span></a>
      <h2 class="section-title">고객정보</h2><div class="card"><div class="card-sub">사용자 ID · ${e(me.userId||'-')}</div></div>
      <a class="list-row" href="support.html"><strong>고객센터</strong><span>›</span></a>
      ${window.KimgosuNative?'<a class="list-row" href="kimgosu://reselect"><strong>테스트 계정 변경</strong><span>›</span></a>':''}`;
    if (me.expertEnabled) root.querySelector('#modeSwitch').onclick = () =>
      api.setMode(me.expertMode ? 'consumer' : 'expert');
  }

  async function renderExpert() {
    root.innerHTML=`<div class="expert-top"><span class="role-badge">고수로 활동 중</span><button id="expertModeSwitch" class="head-action">일반 화면 보기</button></div><h1 class="lead">안녕하세요, ${e(me.customerName || '고수')}님</h1>
      <p class="sub">새 견적 요청을 살펴보고 고객에게 제안해 보세요.</p>
      <div class="hero-card"><h2>나의 전문 서비스를 소개하세요</h2><p>등록한 서비스 분야의 견적에 제안할 수 있어요.</p>
      <a class="primary" href="editor.html?kind=service">서비스 등록하기 →</a></div>
      <div class="section-title">새 견적 요청</div><div id="expertQuotes"></div>
      <a class="outline wide" href="listing.html?kind=quote">견적 요청 더 보기</a>
      <div class="section-title">나의 활동</div>
      <a class="list-row" href="activity.html?section=services"><strong>나의 서비스 관리</strong><span>›</span></a>
      <a class="list-row" href="activity.html?section=proposals"><strong>보낸 제안</strong><span>›</span></a>`;
    root.querySelector('#expertModeSwitch').onclick=()=>api.setMode('consumer');
    try {const data=await api.request('GET','/api/v1/quote-requests?limit=5');
      root.querySelector('#expertQuotes').innerHTML=data.items.length?data.items.map(x=>card(x,'quote')).join(''):
        empty('새 견적 요청이 없습니다','조금 뒤 다시 확인해 주세요.');
    }catch(ex){root.querySelector('#expertQuotes').innerHTML=error(ex.message)}
  }

  async function renderActivity() {
    const section=params.get('section')||'quotes';
    const config={quotes:['나의 견적 요청','/api/v1/me/quote-requests','quote'],
      services:['나의 서비스','/api/v1/me/services','service'],
      proposals:['보낸 제안','/api/v1/me/proposals','proposal']}[section]||['나의 견적 요청','/api/v1/me/quote-requests','quote'];
    root.innerHTML=header(config[0],true)+`<div id="activity"></div>`;
    try {const data=await api.request('GET',config[1]);root.querySelector('#activity').innerHTML=data.items.length?
      data.items.map(x=>config[2]==='proposal'?`<a class="card" href="${link('room.html',{id:x.chatRoomId})}"><strong>${e(x.quoteTitle)}</strong><span class="card-meta">제안 대화 보기 →</span></a>`:card(x,config[2])).join(''):
      empty('아직 내역이 없습니다','등록을 시작해 보세요.','등록하기','kimgosu://tab/2');
    }catch(ex){showError(ex.message)}
  }

  async function renderReceived() {
    const id=params.get('id');root.innerHTML=header('받은 제안',true)+`<div id="received"></div>`;
    try {const data=await api.request('GET',`/api/v1/quote-requests/${encodeURIComponent(id)}/proposals`);
      root.querySelector('#received').innerHTML=data.items.length?data.items.map(x=>
        `<a class="card" href="${link('room.html',{id:x.chatRoomId})}"><span class="pill">고수의 제안</span>
        <div class="card-title" style="margin-top:9px">${e(x.serviceTitle)}</div><div class="card-meta">대화하기 →</div></a>`).join(''):
        empty('아직 받은 제안이 없습니다','전문가의 제안이 도착하면 여기에 표시됩니다.');
    }catch(ex){showError(ex.message)}
  }

  async function renderFavorites() {
    root.innerHTML=header('찜한 서비스',true)+`<div id="favorites"></div>`;
    try{const data=await api.request('GET','/api/v1/me/favorites');root.querySelector('#favorites').innerHTML=
      data.items.length?data.items.map(x=>card(x,'service')).join(''):empty('찜한 서비스가 없습니다','관심 있는 서비스를 찜해 보세요.','둘러보기','kimgosu://tab/1');
    }catch(ex){showError(ex.message)}
  }

  async function renderSupport() {
    root.innerHTML=header('고객센터',true)+`<h1 class="lead">무엇을 도와드릴까요?</h1>
      <p class="sub">앱 이용 중 겪은 문제를 남겨주세요. 접수 내역은 작성한 계정에서만 볼 수 있습니다.</p>
      <form id="supportForm" class="card">
        <div class="form-group"><label for="supportTitle">문의 제목</label><input id="supportTitle" required minlength="2" maxlength="120" placeholder="어떤 도움이 필요하세요?"></div>
        <div class="form-group"><label for="supportBody">문의 내용</label><textarea id="supportBody" required minlength="10" maxlength="4000" placeholder="발생한 상황을 자세히 적어 주세요"></textarea></div>
        <button class="primary wide" type="submit">문의 접수하기</button></form>
      <h2 class="section-title">나의 문의</h2><div id="supportHistory">${empty('불러오는 중','잠시만 기다려 주세요.')}</div>`;
    const history=root.querySelector('#supportHistory');
    let items=[],cursor=null;
    async function load(more=false) {
      try {const result=await api.request('GET','/api/v1/support/tickets'+
        (more&&cursor?'?cursor='+encodeURIComponent(cursor):''));
        items=more?items.concat(result.items):result.items;cursor=result.nextCursor;
        history.innerHTML=items.length?items.map(item=>`<article class="card">
          <span class="pill">접수됨</span><div class="card-title" style="margin-top:9px">${e(item.title)}</div>
          <p class="card-sub">${e(item.body)}</p></article>`).join(''):
          empty('접수한 문의가 없습니다','궁금한 점이 생기면 위에서 문의를 남겨주세요.');
        if(cursor){history.insertAdjacentHTML('beforeend','<button id="supportMore" class="outline wide" type="button">이전 문의 더 보기</button>');
          history.querySelector('#supportMore').onclick=()=>load(true)}
      }catch(ex){history.innerHTML=error(ex.message)}
    }
    root.querySelector('#supportForm').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
      try {await api.request('POST','/api/v1/support/tickets',{
        title:form.querySelector('#supportTitle').value.trim(),body:form.querySelector('#supportBody').value.trim()});
        form.reset();await load();
      }catch(ex){showError(ex.message)}finally{button.disabled=false}
    };
    await load();
  }

  async function start(){
    if (!root)return;
    if (['search','listing','editor','detail','proposal'].includes(page)) await loadCategories();
    switch(page){
      case 'search':await renderSearch(true);break;
      case 'listing':await renderSearch(false);break;
      case 'register':renderRegister();break;
      case 'editor':await renderEditor();break;
      case 'detail':await renderDetail();break;
      case 'proposal':await renderProposal();break;
      case 'chat':await renderChats();break;
      case 'room':await renderRoom();break;
      case 'my':renderMy();break;
      case 'expert':await renderExpert();break;
      case 'activity':await renderActivity();break;
      case 'received':await renderReceived();break;
      case 'favorites':await renderFavorites();break;
      case 'support':await renderSupport();break;
    }
  }
  start().catch(ex=>{root.innerHTML=error(ex.message)});
})();
