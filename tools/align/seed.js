(() => {
  const seed = (f) => {
    f.password = "1234"; f.unlocked = true;
    f.prefs = { ...f.prefs, askPassword: false, theme: "light" };
    f.projects = [{id:1,name:"시도15호선",alias:"",color:null},{id:2,name:"방호벽 정비",alias:"",color:null},{id:3,name:"가을철 도로정비",alias:"",color:null}];
    f.nextProjectId = 4;
    f.contacts = [
      {id:1,name:"박정호",org:"72사단",role:"시설장교",mobile:"010-1234-5678",tel:"031-940-1234",email:"",memo:"",projects:[2]},
      {id:2,name:"김민수",org:"○○설계",role:"과장",mobile:"010-2222-3333",tel:"",email:"kim@ex.kr",memo:"",projects:[1,3]},
      {id:3,name:"이영희",org:"도로관리과",role:"주무관",mobile:"",tel:"031-940-5678",email:"",memo:"",projects:[]},
    ];
    f.nextId = 4;
    const d = "2026-10-16";
    f.days = [{date:d,arrive:"08:40",transport:"",weather:"",note:""},{date:"2026-10-15",arrive:"",transport:"",weather:"",note:""}];
    f.entries = [
      {id:1,date:d,time:"09:10",kind:"유선수신",who:"박정호",contact:"010-1234-5678",project:2,lines:[{who:"박정호",me:false,text:"방호벽 현장 확인 일정 문의"},{who:"나",me:true,text:"다음 주 화요일 가능해요"}],body:""},
      {id:2,date:d,time:"10:30",kind:"회의",who:"김민수",contact:"010-2222-3333",project:1,lines:[{who:"김민수",me:false,text:"설계 변경 검토 결과 공유"}],body:""},
      {id:3,date:d,time:"14:00",kind:"메모",who:"",contact:"",project:null,lines:[],body:"<p>오후 현장 점검</p>"},
      {id:4,date:"2026-10-15",time:"11:00",kind:"협의",who:"이영희",contact:"031-940-5678",project:3,lines:[{who:"이영희",me:false,text:"증빙자료 정리"}],body:""},
    ];
    f.nextEntryId = 5;
    const c = (id,no,status,due,ctype,intake) => ({id,no,intake,received:"2026-10-1"+(id%6),ctype,area:"조리읍",place:"봉일천리 113 일원",person:"홍길동",phone:"010-9999-0000",body:"도로 파손 보수 요청\n배수 확인",action:"현장 확인",due,status,memo:id==2?'[{"t":"메모 내용"}]':""});
    f.complaints = [c(1,1,"접수","2026-10-17","포트홀","전화"),c(2,2,"처리중","2026-10-20","배수불량","국민신문고"),c(3,3,"완료","2026-10-10","차선도색","방문"),c(4,4,"보류","","기타","진정민원"),c(5,5,"접수","2026-10-14","소음","정보공개청구")];
    f.nextComplaintId = 6;
    f.tasks = [
      {id:1,list:2,parent:null,title:"예산 요구서 작성",detail:"",due:"2026-10-16",done:false,doneOn:""},
      {id:2,list:2,parent:1,title:"증감 내역 정리",detail:"",due:"2026-10-18",done:false,doneOn:""},
      {id:3,list:2,parent:null,title:"행정사무감사 자료",detail:"",due:"2026-10-25",done:false,doneOn:""},
      {id:4,list:2,parent:null,title:"공문 회신",detail:"",due:"2026-10-12",done:true,doneOn:"2026-10-12"},
    ];
    f.nextTaskId = 5;
    f.events = [
      {id:1,title:"방호벽 협의",kind:2,date:"2026-10-16",end:"2026-10-16",allDay:false,time:"10:00",endTime:"11:00",repeat:"",until:"",place:"72사단",desc:"",remind:-1,remindTime:""},
      {id:2,title:"현장 출장",kind:3,date:"2026-10-20",end:"2026-10-21",allDay:true,time:"",endTime:"",repeat:"",until:"",place:"",desc:"",remind:-1,remindTime:""},
      {id:3,title:"주간회의",kind:1,date:"2026-10-05",end:"2026-10-05",allDay:false,time:"09:00",endTime:"10:00",repeat:"weekly",until:"2026-12-31",place:"",desc:"",remind:10,remindTime:""},
    ];
    f.nextEventId = 4;
  };
  let v;
  Object.defineProperty(window, "__fake", { configurable: true, get: () => v, set: (x) => { seed(x); v = x; } });
})();
