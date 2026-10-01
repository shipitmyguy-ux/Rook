export function availableShowingSlots(busy = [], {now = new Date(), timeZone = "America/Denver", startHour = 9, endHour = 18, durationMinutes = 60, bufferMinutes = 30, days = 7, limit = 3} = {}) {
  const blocks = busy.map(b=>({start:new Date(b.start).getTime()-bufferMinutes*60000,end:new Date(b.end).getTime()+bufferMinutes*60000}));
  if (blocks.some(b=>!Number.isFinite(b.start)||!Number.isFinite(b.end)||b.end<=b.start)) throw Error("Invalid calendar busy window");
  const fmt=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const parts=t=>Object.fromEntries(fmt.formatToParts(new Date(t)).filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
  const current=parts(now.getTime());const today=current.year+"-"+current.month+"-"+current.day;
  const result=[], dates=new Set();
  for(let t=Math.ceil(now.getTime()/1800000)*1800000;t<now.getTime()+days*86400000;t+=1800000){
    const p=parts(t), date=p.year+"-"+p.month+"-"+p.day;
    if(date===today||dates.has(date))continue;
    const hour=Number(p.hour)+Number(p.minute)/60;
    if(hour<startHour||hour+durationMinutes/60>endHour)continue;
    const end=t+durationMinutes*60000;
    if(blocks.some(b=>t<b.end&&end>b.start))continue;
    dates.add(date);result.push({start:new Date(t).toISOString(),end:new Date(end).toISOString()});
    if(result.length>=limit)break;
  }
  return result;
}
export function availabilityText(slots, timeZone = "America/Denver") {
  const day=new Intl.DateTimeFormat("en-US",{timeZone,weekday:"long",month:"short",day:"numeric"});
  const time=new Intl.DateTimeFormat("en-US",{timeZone,hour:"numeric",minute:"2-digit"});
  return slots.map(s=>day.format(new Date(s.start))+" from "+time.format(new Date(s.start))+" to "+time.format(new Date(s.end))).join("; ");
}
