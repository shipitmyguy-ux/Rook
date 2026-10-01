export function nextPageUrl(currentUrl, links = []) {
  const current = new URL(currentUrl);
  const parse = value => {
    const url = new URL(value);
    for (const key of ['page','p','pageNumber','page_number','currentPage']) {
      if (url.searchParams.has(key)) {
        const page=Number(url.searchParams.get(key));url.searchParams.delete(key);
        return {base:url.origin+url.pathname+url.search,page};
      }
    }
    const match=url.pathname.match(/(?:\/page\/(\d+)|\/(\d+)_p|\/pg-(\d+)|\/(\d+))\/?$/);
    const page=match?Number(match[1]||match[2]||match[3]||match[4]):1;
    const path=match?url.pathname.slice(0,match.index):url.pathname;
    return {base:url.origin+path.replace(/\/$/,'')+url.search,page};
  };
  const now=parse(current.href);
  for(const link of links){
    try{
      const url=new URL(link.href,current.href);
      if(url.origin!==current.origin||!/^\d+$/.test(String(link.text||'').trim()))continue;
      const next=parse(url.href);
      if(next.base===now.base&&next.page===now.page+1)return url.href;
    }catch{}
  }
  return null;
}
