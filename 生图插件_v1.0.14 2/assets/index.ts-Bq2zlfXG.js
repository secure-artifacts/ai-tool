import{e as r}from"./const-CyB7ld5s.js";function d(o,s){chrome.runtime.onMessage.addListener((a,e)=>{a.from===o&&window.postMessage({from:a.from,payload:a.payload,callbackId:a.callbackId})})}d(r);
