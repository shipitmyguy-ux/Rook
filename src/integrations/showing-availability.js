import {availableShowingSlots,availabilityText} from "../core/showing-availability.js";
let token=null,expires=0;
async function calendarToken(clientId) {
  if(!clientId)throw Error("Rook needs a Google OAuth client ID before it can connect to your calendar. Add it in Search preferences.");
  if(token&&Date.now()<expires-60000)return token;
  if(!globalThis.google?.accounts?.oauth2)await new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src="https://accounts.google.com/gsi/client";
    script.onload=resolve;script.onerror=()=>reject(Error("Google sign-in could not load"));document.head.append(script);
  });
  return new Promise((resolve,reject)=>{
    const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:"https://www.googleapis.com/auth/calendar.freebusy",
      callback:r=>{if(r.error||!r.access_token){reject(Error(r.error_description||r.error||"Calendar connection failed"));return;}
      token=r.access_token;expires=Date.now()+Number(r.expires_in||3600)*1000;resolve(token);},
      error_callback:()=>reject(Error("Calendar sign-in was cancelled or blocked"))});
    client.requestAccessToken({prompt:""});
  });
}
export async function personalCalendarAvailability(preferences = {}, properties = []) {
  const accessToken=await calendarToken(preferences.googleOAuthClientId);
  const now=new Date(),timeZone=preferences.showingTimeZone||"America/Denver";
  // Only the signed-in user's primary calendar. Never expand calendar groups.
  const response=await fetch("https://www.googleapis.com/calendar/v3/freeBusy",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify({
    timeMin:now.toISOString(),timeMax:new Date(now.getTime()+7*86400000).toISOString(),timeZone,items:[{id:"primary"}]
  })});
  if(!response.ok){if(response.status===401){token=null;expires=0;}throw Error("Calendar lookup failed; no available times were generated.");}
  const payload=await response.json(), calendar=payload.calendars?.primary;
  if(!calendar||calendar.errors?.length)throw Error("Your personal calendar could not be read; no available times were generated.");
  const localTours=properties.filter(p=>!["rejected","archived"].includes(p.status)).flatMap(p=>{
    const tour=p.metadata?.tour, start=tour?.startsAt||p.showingAt;
    if(!start||["cancelled","canceled"].includes(tour?.status))return [];
    return [{start,end:tour?.endsAt||new Date(new Date(start).getTime()+(Number(tour?.durationMinutes)||60)*60000).toISOString()}];
  });
  const slots=availableShowingSlots([...calendar.busy,...localTours],{now,timeZone,
    startHour:Number(preferences.showingStartHour??9),endHour:Number(preferences.showingEndHour??18),
    durationMinutes:Number(preferences.defaultTourDurationMinutes)||60});
  if(!slots.length)throw Error("No conflict-free times found in the next 7 days within your showing hours.");
  return {text:availabilityText(slots,timeZone),checkedAt:now.toISOString(),validUntil:new Date(now.getTime()+86400000).toISOString()};
}
