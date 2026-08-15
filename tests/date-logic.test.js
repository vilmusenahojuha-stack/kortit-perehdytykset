const assert = require("node:assert/strict");

function lastDayOfMonth(year, month) { return new Date(year, month, 0).getDate(); }
function expiryDate(r) { const d=Number(r.expiresDay)||lastDayOfMonth(r.expiresYear,r.expiresMonth); return new Date(r.expiresYear,r.expiresMonth-1,d,23,59,59,999); }
function warningDate(r) { const months=r.type==="orientation"?1:2; if(!r.expiresDay)return new Date(r.expiresYear,r.expiresMonth-1-months,1); const exp=expiryDate(r); const first=new Date(exp.getFullYear(),exp.getMonth()-months,1); const day=Math.min(exp.getDate(),lastDayOfMonth(first.getFullYear(),first.getMonth()+1)); return new Date(first.getFullYear(),first.getMonth(),day); }
function statusOf(r,now){const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());if(today>expiryDate(r))return"expired";if(today>=warningDate(r))return"warning";return"valid";}

const monthCard={type:"card",expiresDay:"",expiresMonth:12,expiresYear:2031};
assert.equal(expiryDate(monthCard).getDate(),31);
assert.deepEqual([warningDate(monthCard).getFullYear(),warningDate(monthCard).getMonth()+1,warningDate(monthCard).getDate()],[2031,10,1]);
const exactCard={type:"card",expiresDay:15,expiresMonth:12,expiresYear:2031};
assert.deepEqual([warningDate(exactCard).getFullYear(),warningDate(exactCard).getMonth()+1,warningDate(exactCard).getDate()],[2031,10,15]);
const exactOrientation={...exactCard,type:"orientation"};
assert.deepEqual([warningDate(exactOrientation).getFullYear(),warningDate(exactOrientation).getMonth()+1,warningDate(exactOrientation).getDate()],[2031,11,15]);
assert.equal(statusOf(exactCard,new Date(2031,9,14)),"valid");
assert.equal(statusOf(exactCard,new Date(2031,9,15)),"warning");
assert.equal(statusOf(exactCard,new Date(2031,11,15)),"warning");
assert.equal(statusOf(exactCard,new Date(2031,11,16)),"expired");
console.log("date logic: OK");
