/* Keep the reference layout, replacing its sample cards when real services exist. */
(async () => {
  try {
    const profile = KimgosuApi.profile();
    const filters = new URLSearchParams({limit:'50'});
    if (profile.regions?.length) {
      filters.set('regions',profile.regions.join(','));
      filters.set('includeRemote',String(profile.includeRemote !== false));
    }
    const data = await KimgosuApi.request('GET','/api/v1/services?'+filters);
    const items = (data.items || []).filter(item => !item.title?.startsWith('[TEST '));
    if (!items.length) return;
    const recent = document.querySelectorAll('.services .service');
    items.slice(0,2).forEach((item,index) => {
      const card = recent[index]; if (!card) return;
      card.querySelector('a').href = `detail.html?kind=service&id=${encodeURIComponent(item.id)}`;
      card.querySelector('h3').textContent = item.title;
      card.querySelector('.price').textContent = `${Number(item.priceFrom).toLocaleString('ko-KR')}원~`;
      card.querySelector('.badge').textContent = item.categoryCode.replaceAll('_',' ');
    });
    const popular = document.querySelector('.wide-service');
    if (popular && items[2]) {
      const item = items[2];
      popular.href = `detail.html?kind=service&id=${encodeURIComponent(item.id)}`;
      popular.querySelector('h3').textContent = item.title;
      popular.querySelector('.price').textContent = `${Number(item.priceFrom).toLocaleString('ko-KR')}원~`;
    }
  } catch (_) { /* the bundled home remains instant and usable offline */ }
})();
