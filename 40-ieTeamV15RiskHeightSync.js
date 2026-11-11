(function(){
  'use strict';
  let scorecard=null;
  let riskCard=null;
  let resizeObserver=null;
  let mutationObserver=null;
  let frame=0;

  function syncRiskHeight(){
    frame=0;
    scorecard=document.querySelector('#tab-overall .ov-bottom > .ov-c:first-child');
    riskCard=document.querySelector('#tab-overall .ov-bottom > .ov-risk-card');
    if(!scorecard||!riskCard)return;
    const height=Math.ceil(scorecard.getBoundingClientRect().height);
    if(height>40)riskCard.style.setProperty('--ov-scorecard-height',height+'px');
  }
  function scheduleSync(){
    if(frame)cancelAnimationFrame(frame);
    frame=requestAnimationFrame(syncRiskHeight);
  }
  function connect(){
    scorecard=document.querySelector('#tab-overall .ov-bottom > .ov-c:first-child');
    riskCard=document.querySelector('#tab-overall .ov-bottom > .ov-risk-card');
    if(!scorecard||!riskCard)return;
    if('ResizeObserver' in window){
      resizeObserver=new ResizeObserver(scheduleSync);
      resizeObserver.observe(scorecard);
    }
    const body=document.getElementById('ovTeamBody');
    if(body){
      mutationObserver=new MutationObserver(scheduleSync);
      mutationObserver.observe(body,{childList:true,subtree:true,characterData:true});
    }
    window.addEventListener('resize',scheduleSync,{passive:true});
    document.addEventListener('click',function(event){
      if(event.target.closest('[data-tab],.nav-item,#ovRefresh,#ovNow'))setTimeout(scheduleSync,0);
    },true);
    scheduleSync();
    setTimeout(scheduleSync,80);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',connect,{once:true});
  else connect();
})();
