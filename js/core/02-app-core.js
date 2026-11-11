(window.__appFiles=window.__appFiles||{})['02-app-core']='1.4.1';
        const SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY;
        let supabaseClient = null;
        const SUPABASE_TABLES = {
            Users: "users",
            Capacity: "capacity",
            Tasks: "tasks",
            TimeOff_OT: "timeoff_ot",
            Projects: "projects"
        };
        const SUPABASE_TABLE = SUPABASE_TABLES.Users;
        const SUPABASE_TASK_TABLE = SUPABASE_TABLES.Tasks;
        let supabaseReady = false;
        let supabaseInitError = null;

        function initSupabaseClient(){
            try {
                if (supabaseClient && typeof supabaseClient.from === 'function' && supabaseClient.__isRealSupabase) {
                    supabaseReady = true; supabaseInitError = null; return supabaseClient;
                }
                // Legacy window.markDbClient points to localhost:5055 - never use it.
                if (!window.supabase || typeof window.supabase.createClient !== 'function') {
                    throw new Error('Supabase library was not loaded. Check internet or CDN access.');
                }
                supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
                });
                supabaseClient.__isRealSupabase = true;
                window.supabaseDbClient = supabaseClient;
                supabaseReady = true; supabaseInitError = null;
                return supabaseClient;
            } catch (error) {
                supabaseClient = null; supabaseReady = false; supabaseInitError = error;
                console.error('Supabase initialization failed:', error);
                return null;
            }
        }
        initSupabaseClient();

        // ===== SERVER-SIDE FILTERED LOADING (team + selected years, paged by 1000) =====
        const TEAM_FILTERED_TABLES = ['capacity','tasks','timeoff_ot','projects'];
        function serverTeamFilter(table){
            if (!currentUser || !TEAM_FILTERED_TABLES.includes(table)) return null;
            const all = window.TEAM_ALL || '__ALL__';
            const t = String(window.activeTeamView && window.activeTeamView !== all ? window.activeTeamView : (currentUser.team || '')).trim();
            return t || null;
        }
        function getTaskLoadYears(){
            let years = [];
            try { if (typeof bomTopFilterState !== 'undefined') years = [...bomTopFilterState.Year].map(Number).filter(Boolean); } catch(_) {}
            if (years.length) return years.sort((x,y)=>x-y);
            if (window.__taskYearsExplicit) return null;
            return [new Date().getFullYear()];
        }
        function getTaskLoadWindow(){
            const years = getTaskLoadYears();
            if (!years) return null;
            return { start: `${years[0]-1}-12-01`, end: `${years[years.length-1]+1}-01-10`, key: years.join(',') };
        }
        window.getTaskLoadWindow = getTaskLoadWindow;
        async function fetchAllRows(table, orderCol, pageSize = 1000){
            const team = serverTeamFilter(table);
            const win = table === SUPABASE_TABLES.Tasks && currentUser ? getTaskLoadWindow() : null;
            if (table === SUPABASE_TABLES.Tasks) window.__loadedTaskKey = (team||'*') + '|' + (win ? win.key : 'ALL');
            const all = [];
            for (let from = 0; ; from += pageSize) {
                let q = supabaseClient.from(table).select('*');
                if (team) q = q.eq('team', team);
                if (win) {
                    const r = c => `and(${c}.gte.${win.start},${c}.lte.${win.end})`;
                    q = q.or(`${r('start_date')},${r('plan_date')},${r('actual_date')},actual_date.is.null`);
                }
                const { data, error } = await q.order(orderCol, { ascending: true }).order('id', { ascending: true }).range(from, from + pageSize - 1);
                if (error) return { data: null, error };
                all.push(...(data || []));
                if (!data || data.length < pageSize) break;
            }
            return { data: all, error: null };
        }
        window.fetchAllRows = fetchAllRows;
        async function loadTaskYearUniverse(){
            try{
                const team = serverTeamFilter(SUPABASE_TABLES.Tasks);
                let q = supabaseClient.from(SUPABASE_TABLES.Tasks).select('start_date').not('start_date','is',null);
                if (team) q = q.eq('team', team);
                const { data, error } = await q.order('start_date',{ascending:true}).limit(1);
                if (error) throw error;
                const now = new Date().getFullYear();
                const min = data && data[0] ? Number(String(data[0].start_date).slice(0,4)) || now : now;
                const list = []; for (let y = Math.min(min, now); y <= now + 1; y++) list.push(String(y));
                window.__taskYearUniverse = list;
            }catch(e){ console.warn('Year list load failed:', e); }
        }
        window.loadTaskYearUniverse = loadTaskYearUniverse;
        let __taskReloadBusy = null;
        async function ensureTaskYearsLoaded(){
            const team = serverTeamFilter(SUPABASE_TABLES.Tasks);
            const win = getTaskLoadWindow();
            const key = (team||'*') + '|' + (win ? win.key : 'ALL');
            if (key === window.__loadedTaskKey) return false;
            if (__taskReloadBusy) return __taskReloadBusy;
            __taskReloadBusy = (async()=>{ try{ await fetchAllDataFromSheet({background:false, forceRender:true}); } finally { __taskReloadBusy = null; } return true; })();
            return __taskReloadBusy;
        }
        window.ensureTaskYearsLoaded = ensureTaskYearsLoaded;


        function __earlyTeamKey(row){ const d=String((row&&row.team)||'').trim(); if(d) return d.toLowerCase(); try{ if(typeof getWriteTeam==='function') return String(getWriteTeam()||'').trim().toLowerCase(); }catch(_){} return ''; }
        function teamMatch(a,b){ const ka=__earlyTeamKey(a), kb=__earlyTeamKey(b); return !ka||!kb||ka===kb; }
        window.teamMatch=teamMatch;
        let users = [];

        // Canonical PIC names: comparisons are case-insensitive and whitespace-safe,
        // while the display value follows the matching name in Users.
        function cleanPersonDisplayName(value){
            let text=String(value??'');
            try{text=text.normalize('NFKC');}catch(_){ }
            return text
                .replace(/[\u00A0\u2007\u202F]/g,' ')
                .replace(/[\u200B-\u200D\uFEFF]/g,'')
                .replace(/\s+/g,' ')
                .trim();
        }
        function normalizePersonKey(value){
            return cleanPersonDisplayName(value).toLocaleLowerCase();
        }
        let __personNameCache={ref:null,len:-1,map:new Map()};
        function canonicalPersonMap(){
            const list=(typeof users!=='undefined'&&Array.isArray(users))?users:[];
            if(__personNameCache.ref!==list||__personNameCache.len!==list.length){
                const map=new Map();
                list.forEach(u=>{
                    const name=cleanPersonDisplayName(u?.name||u?.username||u?.displayName||'');
                    const key=normalizePersonKey(name);
                    if(!key)return;
                    const current=map.get(key);
                    // If duplicate User rows differ only by case, prefer a normally-cased value
                    // over an all-lowercase variant (for example "Lina" over "lina").
                    if(!current || (!/[A-ZÀ-Þ]/.test(current) && /[A-ZÀ-Þ]/.test(name))) map.set(key,name);
                });
                __personNameCache={ref:list,len:list.length,map};
            }
            return __personNameCache.map;
        }
        function invalidateCanonicalPersonNames(){
            __personNameCache={ref:null,len:-1,map:new Map()};
        }
        function canonicalPersonName(value){
            const cleaned=cleanPersonDisplayName(value);
            if(!cleaned)return '';
            return canonicalPersonMap().get(normalizePersonKey(cleaned))||cleaned;
        }
        function canonicalPersonList(values){
            const source=Array.isArray(values)?values:String(values??'').split(',');
            const seen=new Set(), result=[];
            source.forEach(value=>{
                const name=canonicalPersonName(value), key=normalizePersonKey(name);
                if(!key||seen.has(key))return;
                seen.add(key);result.push(name);
            });
            return result;
        }
        function synchronizePICReferences(){
            invalidateCanonicalPersonNames();
            (Array.isArray(dailyTasks)?dailyTasks:[]).forEach(task=>{
                const pics=canonicalPersonList(Array.isArray(task?.pics)&&task.pics.length?task.pics:task?.pic);
                task.pics=pics;task.pic=pics.join(', ');
            });
            (Array.isArray(timeoffOtList)?timeoffOtList:[]).forEach(item=>{
                item.pic=canonicalPersonName(item?.pic);
            });
            const syncOwner=item=>{
                if(!item||item.owner===undefined)return;
                item.owner=canonicalPersonList(item.owner).join(', ');
            };
            (Array.isArray(projectsList)?projectsList:[]).forEach(project=>{
                const owners=canonicalPersonList(Array.isArray(project?.owners)&&project.owners.length?project.owners:project?.owner);
                project.owners=owners;project.owner=owners.join(', ');
                (project.tasks||[]).forEach(syncOwner);
                (project.phases||[]).forEach(phase=>(phase.tasks||[]).forEach(syncOwner));
            });
        }
        window.cleanPersonDisplayName=cleanPersonDisplayName;
        window.normalizePersonKey=normalizePersonKey;
        window.canonicalPersonName=canonicalPersonName;
        window.canonicalPersonList=canonicalPersonList;
        window.synchronizePICReferences=synchronizePICReferences;

        let __hiddenCache={ref:null,len:-1,set:new Set()};
        // Members counted in Overall headcount but hidden from every report / workload view.
        // Source: js/config.js -> HIDDEN_FROM_REPORTS (default: Anny).
        function configHiddenMembers(){
            const list=(window.APP_CONFIG&&Array.isArray(window.APP_CONFIG.HIDDEN_FROM_REPORTS))?window.APP_CONFIG.HIDDEN_FROM_REPORTS:['Anny'];
            return list.map(n=>normalizePersonKey(n)).filter(Boolean);
        }
        window.configHiddenMembers=configHiddenMembers;
        function hiddenMemberSet(){
            const list=(typeof users!=='undefined'&&Array.isArray(users))?users:[];
            if(__hiddenCache.ref!==list||__hiddenCache.len!==list.length){
                __hiddenCache={ref:list,len:list.length,set:new Set([...list.filter(u=>u&&u.show===false).map(u=>normalizePersonKey(u.name||u.username||u.displayName||'')),...configHiddenMembers()].filter(Boolean))};
            }
            return __hiddenCache.set;
        }
        function isHiddenMember(name){ const k=normalizePersonKey(name); return !!k&&hiddenMemberSet().has(k); }
        function isReportableActiveUser(user){
            return !!user && String(user.status||'').trim().toLowerCase()==='active' && !isHiddenMember(user.name||user.username||user.displayName||'');
        }
        function reportableTaskPICs(task){
            return taskPICs(task).filter(name=>!isHiddenMember(name));
        }
        function taskIncludedInStatistics(task){
            const assigned=taskPICs(task);
            return !assigned.length || assigned.some(name=>!isHiddenMember(name));
        }
        window.isHiddenMember=isHiddenMember;
        window.isReportableActiveUser=isReportableActiveUser;
        window.reportableTaskPICs=reportableTaskPICs;
        window.taskIncludedInStatistics=taskIncludedInStatistics;
        window.invalidateHiddenMembers=()=>{__hiddenCache.ref=null;};
        let capacityData = [];
        let dailyTasks = [];
        let timeoffOtList = [];
        const REQUESTS_LIST_VISIBLE_ROWS = 8;
        let projectsList = [];
        let currentUser = null;
        
        let currentCalendarView = 'week';
        let currentCalendarAnchor = new Date();
        let currentGanttView = 'month';
        let currentGanttAnchor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

        let chartWorkload = null;
        let chartStatus = null;

        let activeFilterDropdown = null;
        let appNotificationResolve = null;
        const sheetSavePending = {};

        // Supabase is the single source of truth. No application data is read from localStorage.


        function ensureTaskIds(tasks){
            if(!Array.isArray(tasks)) return tasks || [];
            const used=new Set();
            let nextId=Date.now();
            tasks.forEach(task=>{
                let id=task?.id;
                if(id===undefined || id===null || String(id).trim()==='' || used.has(String(id))){
                    do{id=nextId++;}while(used.has(String(id)));
                    task.id=id;
                }
                used.add(String(task.id));
            });
            return tasks;
        }

        function dedupeTasks(tasks){
            if(!Array.isArray(tasks)) return [];
            const seen=new Set(), result=[];
            tasks.forEach(task=>{
                const key=(task?.id!==undefined && task?.id!==null && String(task.id)!=='')
                    ? `id:${task.id}`
                    : `fallback:${String(task?.category||'').trim().toLowerCase()}|${String(task?.name||task?.task||'').trim().toLowerCase()}|${cleanDateStr(task?.start||task?.startDate||'')}|${String(task?.pic||'').trim().toLowerCase()}`;
                if(seen.has(key)) return;
                seen.add(key); result.push(task);
            });
            return result;
        }

        function isProjectHoursTask(task){
            if(!task) return false;
            return String(task.category||'').trim().toLowerCase()==='project' &&
                   String(task.name||'').trim().toLowerCase()==='project processing';
        }

        function applyPendingGanttHoursToState(){
            if(typeof pendingGanttHours==='undefined') return;
            pendingGanttHours.forEach(entry=>{
                const project=projectsList.find(p=>String(p.id)===String(entry.projectId));
                if(!project || !entry.dateIso) return;
                project.hoursUsed=project.hoursUsed||{};
                if(Number(entry.hours)>0) project.hoursUsed[entry.dateIso]=Number(entry.hours);
                else delete project.hoursUsed[entry.dateIso];
            });
        }

        function projectPriorityToTaskPriority(value){
            const n=Number(value);
            if(!Number.isFinite(n)) return ['High','Medium','Low'].includes(String(value||'').trim()) ? String(value).trim() : 'Medium';
            if(n<=2) return 'Low';
            if(n===3) return 'Medium';
            return 'High';
        }

        function showToast(message){
            if(typeof showAppNotification==='function') showAppNotification(message);
            else console.info(message);
        }


        document.addEventListener("DOMContentLoaded", () => {
            setupInlineRequiredValidation();
            initCalendarAnchor();
            currentGanttAnchor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

            // Saturday Matrix Year/Month controls are initialized by the V19 period module.

            // IMPORTANT: Do not block the Login screen on the full database load.
            // The previous version loaded every table before showing Login, so a slow/blocked
            // Supabase request could leave the hamster loading screen visible forever.
            const initLoader = document.getElementById('initialLoadingScreen');
            if(initLoader){
                initLoader.classList.add('opacity-0','pointer-events-none');
                setTimeout(()=>{initLoader.style.display='none';},300);
            }
            const loginScreen = document.getElementById('loginScreen');
            if(loginScreen) loginScreen.classList.remove('hidden');

            // Do not hydrate application data from browser cache. Data is loaded after Supabase login.
        });

        function initCalendarAnchor() {
            currentCalendarAnchor = new Date();
            const day = currentCalendarAnchor.getDay();
            const diff = currentCalendarAnchor.getDate() - day + (day === 0 ? -6 : 1);
            currentCalendarAnchor.setDate(diff);
            currentCalendarAnchor.setHours(0,0,0,0);
        }

        function cleanDateStr(dStr) {
            if (dStr === null || dStr === undefined || dStr === '') return '';
            if (dStr instanceof Date && !isNaN(dStr.getTime())) return formatDateLocal(dStr);

            // SheetJS may return an Excel serial number when the source cell is a
            // real Excel date. Convert it before doing any string parsing.
            if (typeof dStr === 'number' && Number.isFinite(dStr)) {
                if (window.XLSX?.SSF?.parse_date_code) {
                    const dc = XLSX.SSF.parse_date_code(dStr);
                    if (dc && dc.y && dc.m && dc.d) {
                        return `${String(dc.y).padStart(4,'0')}-${String(dc.m).padStart(2,'0')}-${String(dc.d).padStart(2,'0')}`;
                    }
                }
                // Excel's common 1900 date system fallback.
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                const dt = new Date(excelEpoch.getTime() + Math.floor(dStr) * 86400000);
                if (!isNaN(dt.getTime())) return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
            }

            const raw = String(dStr).trim();
            if (!raw || raw === '-' || raw === '—' || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'n/a') return '';

            // Date-only ISO values must stay exactly on their stored calendar day.
            let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m) return `${m[1]}-${m[2]}-${m[3]}`;

            // Supabase/API can return a date as an ISO timestamp in UTC.
            // Convert that timestamp to the app's Vietnam calendar date.
            if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
                const dt = new Date(raw);
                if (!isNaN(dt.getTime())) {
                    const parts = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        year: 'numeric', month: '2-digit', day: '2-digit'
                    }).formatToParts(dt).reduce((o,p)=>{o[p.type]=p.value; return o;},{});
                    if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
                }
                return '';
            }

            // Common spreadsheet text formats: M/D/YYYY, M-D-YYYY, DD/MM/YYYY.
            m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (m) {
                const a=Number(m[1]), b=Number(m[2]), y=Number(m[3]);
                // For slash dates, retain the existing app convention (month/day/year).
                // For dash dates, also accept day-month-year when the first value > 12.
                const month = a > 12 ? b : a;
                const day = a > 12 ? a : b;
                if (month>=1 && month<=12 && day>=1 && day<=31) return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            }

            // Excel/text exports frequently contain values such as "4-Aug" or
            // "04-Aug-2026". If the year is omitted, use the current year.
            const monthNames='Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December';
            m = raw.match(new RegExp(`^(\d{1,2})[-\s](${monthNames})(?:[-\s,]+(\d{2,4}))?$`,'i'));
            if (m) {
                const day=Number(m[1]);
                const monthText=m[2].toLowerCase();
                const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
                const month=months[monthText];
                let year=m[3]?Number(m[3]):new Date().getFullYear();
                if (year<100) year += year>=70 ? 1900 : 2000;
                if (month && day>=1 && day<=31) return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            }

            // Also accept "Aug-4", "Aug 4, 2026", and similar human-readable values.
            const parsed=Date.parse(raw);
            if (!isNaN(parsed)) {
                const dt=new Date(parsed);
                return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
            }

            // Never return an arbitrary non-date string to a PostgreSQL DATE column.
            return '';
        }

        function mapDbUserToApp(r){
            return { id:r?.id, team:r?.team||'', name:r?.name||'', password:r?.password??'', role:r?.role||'Member', status:r?.status||'Active', show:r?.show_in_reports!==false&&!configHiddenMembers().includes(normalizePersonKey(r?.name||'')), createdAt:r?.created_at||'', updatedAt:r?.updated_at||'' };
        }
        function mapDbCapacityToApp(r){
            return { id:r?.id, team:r?.team||'', category:r?.category||'', task:r?.task||'', scope:r?.scope||"In BOM's scope", workload:Number(r?.workload||0) };
        }
        function mapDbTaskToApp(r){
            const pics = canonicalPersonList(r?.pic || '');
            const creator = users.find(u=>String(u.id)===String(r?.created_by));
            const updater = users.find(u=>String(u.id)===String(r?.updated_by));
            return {
                id: r?.id, team: r?.team || '',
                category: r?.category || '', name: r?.name || '', items: r?.items || '', scope: r?.scope || '',
                priority: r?.priority || 'Medium', pic: pics.join(', '), pics,
                start: cleanDateStr(r?.start_date), plan: cleanDateStr(r?.plan_date), actual: cleanDateStr(r?.actual_date),
                startDate: cleanDateStr(r?.start_date), planDate: cleanDateStr(r?.plan_date), actualDate: cleanDateStr(r?.actual_date),
                usageTime: Number(r?.usage_time || 0), discipline: r?.discipline || '', status: r?.status || '',
                projectId: r?.project_id ?? '',
                createdBy: creator?.name || r?.created_by || '', updatedBy: updater?.name || r?.updated_by || '',
                createdById: r?.created_by ?? null, updatedById: r?.updated_by ?? null,
                savedAt: r?.saved_at || r?.updated_at || '', createdAt: r?.created_at || '', updatedAt: r?.updated_at || ''
            };
        }
        function mapDbTimeoffToApp(r){
            return { id:r?.id, team:r?.team||'', type:r?.type||'', pic:canonicalPersonName(r?.pic||''), startDate:cleanDateStr(r?.start_date), endDate:cleanDateStr(r?.end_date), hours:Number(r?.hours||0), reason:r?.reason||'', createdAt:r?.created_at||'', updatedAt:r?.updated_at||'' };
        }
        function getProjectMetaFromStorage(hoursUsed){
            const raw=(hoursUsed&&typeof hoursUsed==='object')?hoursUsed:{};
            const meta=(raw.__projectMeta&&typeof raw.__projectMeta==='object')?raw.__projectMeta:{};
            return {gainDemand:meta.gainDemand??'',detailedStatus:String(meta.detailedStatus??''),phases:Array.isArray(meta.phases)?meta.phases:[],tasks:Array.isArray(meta.tasks)?meta.tasks:[]};
        }
        let projectBuilderIdCounter=0;
        function projectBuilderId(type){
            projectBuilderIdCounter=(projectBuilderIdCounter+1)%1000000;
            return `local_${type}_${Date.now()}_${projectBuilderIdCounter}_${Math.random().toString(36).slice(2,7)}`;
        }
        function buildProjectStorageHours(project){
            const raw={...(project?.hoursUsed&&typeof project.hoursUsed==='object'?project.hoursUsed:{})};
            const phases=(Array.isArray(project?.phases)?project.phases:[]).map((ph,pi)=>({
                ...ph,
                sortOrder:pi,
                tasks:(Array.isArray(ph?.tasks)?ph.tasks:[]).map((t,ti)=>({...t,sortOrder:ti}))
            }));
            const directTasks=(Array.isArray(project?.tasks)?project.tasks:[]).map((t,ti)=>({...t,sortOrder:ti}));
            raw.__projectMeta={gainDemand:project?.gainDemand??'',detailedStatus:String(project?.detailedStatus??''),phases,tasks:directTasks};
            return raw;
        }

function calculateProjectTaskStatus(task, todayIso=formatDateLocal(new Date())){
            const start=cleanDateStr(task?.startDate), plan=cleanDateStr(task?.dueDate), actual=cleanDateStr(task?.actualDate);
            if(actual) return 'Completed';
            if(!start || !plan) return 'Not Started';
            if(todayIso < start) return 'Not Started';
            if(todayIso > plan) return 'Overdue';
            return 'Working';
        }
        function clampProjectTaskDate(value,project){
            const d=cleanDateStr(value), s=cleanDateStr(project?.startDate), e=cleanDateStr(project?.dueDate);
            if(!d) return '';
            if(s && d<s) return s;
            if(e && d>e) return e;
            return d;
        }
        function deriveProjectPhaseSchedule(phase,project){
            const tasks=Array.isArray(phase?.tasks)?phase.tasks:[];
            const starts=tasks.map(t=>cleanDateStr(t.startDate)).filter(Boolean).sort();
            const plans=tasks.map(t=>cleanDateStr(t.dueDate)).filter(Boolean).sort();
            /* Phase Actual Completion is valid only after EVERY child task has
               an actual date. Once complete, use the latest child actual date. */
            const actuals=tasks.map(t=>cleanDateStr(t.actualDate)).filter(Boolean).sort();
            const allTasksHaveActual=tasks.length>0 && actuals.length===tasks.length;
            const startDate=starts.length?starts[0]:'';
            const dueDate=plans.length?plans[plans.length-1]:'';
            const actualDate=allTasksHaveActual?actuals[actuals.length-1]:'';
            return {startDate,dueDate,actualDate};
        }

function normalizeProjectTasks(tasks,project){
            return (Array.isArray(tasks)?tasks:[]).map((t,ti)=>{
                const start=cleanDateStr(t?.startDate);
                const due=cleanDateStr(t?.dueDate);
                const actual=cleanDateStr(t?.actualDate);
                const safeDue=(start&&due&&due<start)?start:due;
                const safeActual=(actual&&start&&actual<start)?start:actual;
                return {
                    id:t?.id||`task_${Date.now()}_direct_${ti}_${Math.random().toString(36).slice(2,6)}`,
                    name:String(t?.name||`Task ${ti+1}`),owner:String(t?.owner||''),
                    startDate:start,dueDate:safeDue,actualDate:safeActual,
                    detail:String(t?.detail||''),gainDemand:String(t?.gainDemand||''),
                    estSaving:t?.estSaving??'',actualSaving:t?.actualSaving??'',
                    note:String(t?.note||''),progress:Math.max(0,Math.min(100,Number(t?.progress)||0)),
                    status:calculateProjectTaskStatus({startDate:start,dueDate:safeDue,actualDate:safeActual})
                };
            });
        }

        function normalizeProjectPhases(phases,project){
            return (Array.isArray(phases)?phases:[]).map((ph,index)=>{
                const sourceTasks=Array.isArray(ph?.tasks)?ph.tasks:[];
                const tasks=normalizeProjectTasks(sourceTasks,project);
                const derived=deriveProjectPhaseSchedule({tasks},null);
                return {
                    id:ph?.id||`phase_${Date.now()}_${index}_${Math.random().toString(36).slice(2,6)}`,
                    name:String(ph?.name||`Phase ${index+1}`),
                    startDate:derived.startDate,dueDate:derived.dueDate,actualDate:derived.actualDate,
                    tasks
                };
            });
        }
        function mapDbProjectToApp(r){

            const owners=Array.isArray(r?.owners)?r.owners:(r?.owner?String(r.owner).split(',').map(x=>x.trim()).filter(Boolean):[]);
            const hoursUsed=(r?.hours_used&&typeof r.hours_used==='object')?r.hours_used:{};
            const meta=getProjectMetaFromStorage(hoursUsed);
            const project={ id:r?.id, team:r?.team||'', name:r?.name||'', owner:r?.owner||owners.join(', '), owners, scope:r?.scope||'Projects', detail:r?.detail||'', status:r?.status||'Working on it', progress:Number(r?.progress||0), startDate:cleanDateStr(r?.start_date), dueDate:cleanDateStr(r?.due_date), actualDate:cleanDateStr(r?.actual_date), priority:Number(r?.priority||3), gainDemand:r?.gain_demand??meta.gainDemand, currentStage:String(r?.current_stage??meta.currentStage??meta.stage??''), archivedGoal:String(r?.archived_goal??meta.archivedGoal??meta.detailedStatus??''), keyProject:(r?.key_project===undefined||r?.key_project===null)?(meta.keyProject===undefined?true:!(/^(false|0|no|n|off)$/i.test(String(meta.keyProject).trim()))):!(/^(false|0|no|n|off)$/i.test(String(r.key_project).trim())), detailedStatus:String(r?.archived_goal??meta.archivedGoal??meta.detailedStatus??''), phases:meta.phases, tasks:meta.tasks, saving:r?.saving??0, actualSaving:r?.actual_saving??'', note:r?.note||'', hoursUsed, createdAt:r?.created_at||'', updatedAt:r?.updated_at||'' };
            project.phases=normalizeProjectPhases(project.phases,project);
            return project;
        }

        async function fetchAllDataFromSheet({background = false, forceRender = false} = {}) {
            if(!initSupabaseClient()){
                const err=supabaseInitError || new Error('Supabase client is not available.');
                if(!background) showAppNotification(err.message,'Supabase Connection');
                return false;
            }
            const initLoader = document.getElementById('initialLoadingScreen');
            const syncLoader = document.getElementById('loadingOverlay');
            if (!background && currentUser && syncLoader) syncLoader.classList.remove('opacity-0','pointer-events-none');
            try {
                const [u,c,t,to,p] = await Promise.all([
                        fetchAllRows(SUPABASE_TABLES.Users,'id'),
                        fetchAllRows(SUPABASE_TABLES.Capacity,'id'),
                        fetchAllRows(SUPABASE_TABLES.Tasks,'updated_at'),
                        fetchAllRows(SUPABASE_TABLES.TimeOff_OT,'id'),
                        fetchAllRows(SUPABASE_TABLES.Projects,'id')
                    ]);
                for(const result of [u,c,t,to,p]) if(result.error) throw result.error;
                const data={
                    Users:(u.data||[]).map(mapDbUserToApp),
                    Capacity:(c.data||[]).map(mapDbCapacityToApp),
                    Tasks:(t.data||[]).map(mapDbTaskToApp),
                    TimeOff_OT:(to.data||[]).map(mapDbTimeoffToApp),
                    Projects:(p.data||[]).map(mapDbProjectToApp)
                };
                // Never cancel a refresh just because another save is running.
                // We protect the sheet that is currently being edited/saved below,
                // while still allowing the other tables to refresh immediately.
                const incoming={
                    Users:Array.isArray(data?.Users)?data.Users:[], Capacity:Array.isArray(data?.Capacity)?data.Capacity:[],
                    Tasks:Array.isArray(data?.Tasks)?data.Tasks:[], TimeOff_OT:Array.isArray(data?.TimeOff_OT)?data.TimeOff_OT:[], Projects:Array.isArray(data?.Projects)?data.Projects:[]
                };
                const currentState={Users:users,Capacity:capacityData,Tasks:dailyTasks,TimeOff_OT:timeoffOtList,Projects:projectsList};
                const protectedIncoming={...incoming};
                if(background) Object.keys(protectedIncoming).forEach(k=>{
                    // Keep local data while a write is queued/in flight or for a short
                    // settling window after a successful local save. Other sheets still refresh.
                    if(sheetLatestLocal[k] || sheetSyncInFlight[k] || (lastLocalSaveAt[k]&&Date.now()-lastLocalSaveAt[k]<4000)) {
                        protectedIncoming[k]=currentState[k];
                    }
                });
                const changedSheets=Object.keys(protectedIncoming).filter(k=>JSON.stringify(protectedIncoming[k])!==JSON.stringify(currentState[k]));
                if(background&&changedSheets.length){const ae=document.activeElement;const editing=ae&&/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);const modalOpen=document.querySelector('.modal:not(.opacity-0):not(.pointer-events-none)');if(editing||modalOpen)return false;}
                users=protectedIncoming.Users;capacityData=protectedIncoming.Capacity;dailyTasks=protectedIncoming.Tasks;timeoffOtList=protectedIncoming.TimeOff_OT;projectsList=protectedIncoming.Projects;
                capacityData.forEach(c=>{c.id=Number(c.id)||c.id;c.category=String(c.category||'').trim();c.task=String(c.task||'').trim();c.scope=String(c.scope||"In BOM's scope").trim();c.workload=Number(c.workload||0)||0;});
                dailyTasks.forEach(t=>{if(!t.pics&&t.pic)t.pics=String(t.pic).split(',').map(s=>s.trim()).filter(Boolean);if(!t.pics)t.pics=[];t.start=cleanDateStr(t.start);t.plan=cleanDateStr(t.plan);t.actual=cleanDateStr(t.actual);});
                ensureTaskIds(dailyTasks);dailyTasks=dedupeTasks(dailyTasks);
                timeoffOtList.forEach(t=>{t.startDate=cleanDateStr(t.startDate);t.endDate=cleanDateStr(t.endDate);});
                projectsList.forEach(p=>{p.scope=CAPACITY_SCOPES.includes(String(p.scope||'').trim())?String(p.scope).trim():'Projects';p.startDate=cleanDateStr(p.startDate);p.dueDate=cleanDateStr(p.dueDate);p.actualDate=cleanDateStr(p.actualDate);if(!p.owners&&p.owner)p.owners=String(p.owner).split(',').map(s=>s.trim()).filter(Boolean);if(!p.hoursUsed)p.hoursUsed={};const meta=getProjectMetaFromStorage(p.hoursUsed);p.gainDemand=String(p.gainDemand||meta.gainDemand||'');p.tasks=normalizeProjectTasks(p.tasks||meta.tasks,p);p.phases=normalizeProjectPhases(p.phases||meta.phases,p);});
                synchronizePICReferences();
                applyPendingGanttHoursToState();
                const curState={Users:users,Capacity:capacityData,Tasks:dailyTasks,TimeOff_OT:timeoffOtList,Projects:projectsList};
                Object.keys(curState).forEach(k=>sheetSyncSnapshots[k]=JSON.parse(JSON.stringify(curState[k])));
                if(!background||changedSheets.length||forceRender){populateFilterOptions();if(!window._bomDefaultsInitialized){setBomCurrentPeriodDefaults();window._bomDefaultsInitialized=true;}updateDashboardFinancialKpis();updateBomFilterButtons();window.bomFilteredTasks=dailyTasks.filter(taskPassesBomTopFilters);renderCapacityTable();renderDailyTrackingTable();renderMyTasksTable();renderTimeoffOtTable();renderGanttChart();renderProjectsTable();renderWeeklyCalendar();renderUserManagementTable();renderSaturdayMatrixTable();initDashboardCharts();onTimeoffTypeChange();restoreAdvancedTableFilters();}
                return true;
            }catch(err){console.error('Supabase Fetch Error:',err);if(!background)showAppNotification(`Unable to load data from Supabase. ${err.message||''}`,'Database Error');return false;}
            finally{if(!background){if(initLoader){initLoader.classList.add('opacity-0','pointer-events-none');setTimeout(()=>{initLoader.style.display='none';},500);}if(syncLoader)syncLoader.classList.add('opacity-0','pointer-events-none');}}
        }

        const sheetSyncSnapshots = {};
        const sheetSyncInFlight = {};
        // Serialize writes per sheet so rapid edits/imports cannot overwrite each other.
        const sheetSaveQueues = {};
        function stableRowKey(sheetName,row){
            if(!row||typeof row!=='object')return JSON.stringify(row);
            if(row.id!==undefined&&row.id!==null&&row.id!=='')return `id:${row.id}`;
            if(sheetName==='Users')return `user:${String(row.name||'').trim().toLowerCase()}`;
            if(sheetName==='Capacity')return `capacity:${row.category||''}|${row.task||''}|${row.scope||row.unit||''}`;
            if(sheetName==='Tasks')return `task:${row.id||''}`;
            if(sheetName==='TimeOff_OT')return `timeoff:${row.id||''}`;
            if(sheetName==='Projects')return `project:${row.id||''}`;
            return `row:${JSON.stringify(row)}`;
        }
        let autoSyncTimer=null;
        const lastLocalSaveAt={};
        const pendingGanttHours=new Map();
        const pendingRowDeletions={Tasks:new Set(),Projects:new Set(),TimeOff_OT:new Set(),Capacity:new Set(),Users:new Set()};
        function ganttHoursKey(projectId,dateIso){return `${String(projectId)}__${String(dateIso)}`;}
        let activeSaves=0;
        // Prevent accidental double-submit while the first request is still pending.
        // A short-lived fingerprint also blocks a second identical create after the first
        // request completed but the UI response arrived late.
        const formSaveLocks = Object.create(null);
        const recentCreateFingerprints = new Map();
        function normalizeSavePart(v){ return String(v ?? '').trim().replace(/\s+/g,' ').toLowerCase(); }
        function makeCreateFingerprint(type, parts){
            return `${type}|${parts.map(normalizeSavePart).join('|')}`;
        }
        function beginFormSave(formId, fingerprint=''){
            const form=document.getElementById(formId);
            if(form?.dataset.saving==='1' || formSaveLocks[formId]) return false;
            if(fingerprint){
                const now=Date.now(), last=recentCreateFingerprints.get(fingerprint)||0;
                if(now-last < 15000) return false;
                recentCreateFingerprints.set(fingerprint, now);
            }
            formSaveLocks[formId]=true;
            if(form){
                form.dataset.saving='1';
                form.querySelectorAll('button[type="submit"]').forEach(btn=>{
                    btn.disabled=true;
                    btn.dataset.saveOriginalHtml=btn.innerHTML;
                    btn.innerHTML='<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';
                    btn.classList.add('opacity-60','cursor-not-allowed');
                });
            }
            return true;
        }
        function endFormSave(formId){
            formSaveLocks[formId]=false;
            const form=document.getElementById(formId);
            if(!form) return;
            form.dataset.saving='0';
            form.querySelectorAll('button[type="submit"]').forEach(btn=>{
                btn.disabled=false;
                if(btn.dataset.saveOriginalHtml) btn.innerHTML=btn.dataset.saveOriginalHtml;
                btn.classList.remove('opacity-60','cursor-not-allowed');
            });
        }
        function forgetCreateFingerprint(fingerprint){ if(fingerprint) recentCreateFingerprints.delete(fingerprint); }

function clearRequiredFieldInvalid(el){
    if(!el) return;
    el.classList.remove('bom-required-invalid');
}
function markRequiredFieldInvalid(el){
    if(!el) return;
    el.classList.add('bom-required-invalid');
}
function validateRequiredFormFields(form){
    if(!form) return true;
    let valid=true;
    form.querySelectorAll('[required]').forEach(el=>{
        const isHidden=el.disabled || el.type==='hidden' || el.offsetParent===null;
        if(isHidden) return;
        const filled=(el.type==='checkbox'||el.type==='radio') ? el.checked : String(el.value ?? '').trim()!=='';
        if(!filled){ markRequiredFieldInvalid(el); valid=false; } else clearRequiredFieldInvalid(el);
    });
    return valid;
}
function setupInlineRequiredValidation(){
    document.querySelectorAll('form').forEach(form=>{
        form.addEventListener('input',e=>{
            if(e.target.matches('[required]')){
                const el=e.target;
                const filled=(el.type==='checkbox'||el.type==='radio') ? el.checked : String(el.value ?? '').trim()!=='';
                if(filled) clearRequiredFieldInvalid(el);
            }
        });
        form.addEventListener('change',e=>{
            if(e.target.matches('[required]')){
                const el=e.target;
                const filled=(el.type==='checkbox'||el.type==='radio') ? el.checked : String(el.value ?? '').trim()!=='';
                if(filled) clearRequiredFieldInvalid(el);
            }
        });
        form.addEventListener('invalid',e=>{ e.preventDefault(); markRequiredFieldInvalid(e.target); },true);
    });
}
        // Safe save-status hook. The current UI has no dedicated save-indicator element,
        // so persistence must never fail just because an optional indicator is unavailable.
        function updateSaveIndicator(){
            const indicator=document.getElementById('saveIndicator');
            if(!indicator) return;
            indicator.textContent=activeSaves>0?'Saving...':'Saved';
            indicator.classList.toggle('text-amber-600',activeSaves>0);
            indicator.classList.toggle('text-emerald-600',activeSaves===0);
        }
        const sheetLatestLocal={};
        function startMultiUserAutoSync(){
            // Supabase Realtime is the live transport. No polling fallback is needed.
            if(autoSyncTimer){clearInterval(autoSyncTimer);autoSyncTimer=null;}
            if(!window._bomVisBound){
                window._bomVisBound=true;
                // PERF: only reload everything when the tab was hidden for a while
                // (realtime keeps data fresh while visible; short Alt+Tab no longer freezes the app).
                let hiddenAt=0;
                document.addEventListener('visibilitychange',()=>{
                    if(document.hidden){hiddenAt=Date.now();return;}
                    if(currentUser&&hiddenAt&&Date.now()-hiddenAt>=60000) fetchAllDataFromSheet({background:true}).catch(()=>{});
                    hiddenAt=0;
                });
            }
        }
        async function manualCloudSync(){
            const btn=document.getElementById('syncCloudBtn');
            const icon=btn?.querySelector('i');
            const label=btn?.querySelector('span');
            if(btn)btn.disabled=true;
            if(icon)icon.classList.add('fa-spin');
            if(label)label.textContent='Syncing...';
            try{
                const ok=await fetchAllDataFromSheet({background:false});
                if(ok)showToast('Cloud data synchronized');
            }finally{
                if(icon)icon.classList.remove('fa-spin');
                if(label)label.textContent='Sync Cloud';
                if(btn)btn.disabled=false;
            }
        }
        function rowIdForSupabase(sheet,row){
            if(sheet==='Users')return String(row.name||'').trim().toLowerCase();
            if(row.id!==undefined&&row.id!==null&&String(row.id)!=='')return String(row.id);
            return stableRowKey(sheet,row);
        }
        function toDbDateValue(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?`${v}T12:00:00.000Z`:v;}
        function saveSheetData(sheetName,rowsData){
            if(currentUser?.isReadOnly){
                if(typeof showAppNotification==='function') showAppNotification('Viewer access is read-only. Changes were not saved.','View only');
                return Promise.resolve(false);
            }
            sheetLatestLocal[sheetName]=JSON.parse(JSON.stringify(Array.isArray(rowsData)?rowsData:[]));
            activeSaves++;updateSaveIndicator();
            sheetSaveQueues[sheetName]=(sheetSaveQueues[sheetName]||Promise.resolve()).catch(()=>{}).then(()=>runSheetSave(sheetName)).finally(()=>{activeSaves--;updateSaveIndicator();});
            return sheetSaveQueues[sheetName];
        }

        function tableForSheet(sheetName){return SUPABASE_TABLES[sheetName];}
        window.testTimeoffOtDatabase=async function(){
            if(!initSupabaseClient()) throw new Error('Supabase client is not initialized.');
            const table=SUPABASE_TABLES.TimeOff_OT;
            const res=await supabaseClient.from(table).select('*').limit(1);
            console.log('TimeOff_OT database test:',{table,data:res.data,error:res.error});
            if(res.error) throw res.error;
            return res.data||[];
        };
        function rowHasDbId(row){return Number.isSafeInteger(Number(row?.id)) && Number(row.id)>0;}
        function dbPayloadForSheet(sheetName,row){
            if(sheetName==='Users') return {name:String(row.name||'').trim(),password:String(row.password??''),role:row.role||'Member',status:row.status||'Active'};
            if(sheetName==='Capacity') return {category:String(row.category||'').trim(),task:String(row.task||'').trim(),scope:String(row.scope||"In BOM's scope").trim(),workload:Math.max(0,Number(row.workload)||0)};
            if(sheetName==='TimeOff_OT') {
                const type=String(row?.type??'').trim();
                const pic=String(row?.pic??'').trim();
                const startDate=cleanDateStr(row?.startDate);
                const endDate=cleanDateStr(row?.endDate||row?.startDate)||startDate;
                const n=Number(row?.hours);
                const hours=Number.isFinite(n) ? Math.max(0,n) : 0;
                const reason=String(row?.reason??'').trim();
                return {
                    type,
                    pic,
                    start_date:startDate||null,
                    end_date:endDate||startDate||null,
                    hours,
                    reason:reason||null
                };
            }
            if(sheetName==='Projects') return {name:String(row.name||'').trim(),owner:Array.isArray(row.owners)?row.owners.join(', '):(row.owner||null),owners:Array.isArray(row.owners)?row.owners:[],scope:row.scope||'Projects',detail:row.detail||'',status:row.status||'Not Started',progress:Math.max(0,Math.min(100,Number(row.progress)||0)),start_date:cleanDateStr(row.startDate)||null,due_date:cleanDateStr(row.dueDate)||null,actual_date:cleanDateStr(row.actualDate)||null,priority:Number(row.priority)||3,gain_demand:row.gainDemand??'',saving:row.saving===''?0:(Number.isFinite(Number(row.saving))?Number(row.saving):0),actual_saving:row.actualSaving===''?null:(Number.isFinite(Number(row.actualSaving))?Number(row.actualSaving):0),note:row.note||null,current_stage:String(row.currentStage??'').trim(),archived_goal:String(row.archivedGoal??row.detailedStatus??'').trim(),key_project:row.keyProject===undefined||row.keyProject===null||row.keyProject===''?true:!(/^(false|0|no|n|off)$/i.test(String(row.keyProject).trim())),hours_used:buildProjectStorageHours(row)};
            return null;
        }
        function mapSavedRow(sheetName,r){
            if(sheetName==='Users')return mapDbUserToApp(r);
            if(sheetName==='Capacity')return mapDbCapacityToApp(r);
            if(sheetName==='Tasks')return mapDbTaskToApp(r);
            if(sheetName==='TimeOff_OT')return mapDbTimeoffToApp(r);
            if(sheetName==='Projects')return mapDbProjectToApp(r);
            return r;
        }
        function getTaskWriteTeam(row){
            // Member / Team Admin: own team. App Admin: team selected in the app.
            const all = window.TEAM_ALL || '__ALL__';
            const selected = String(window.activeTeamView || '').trim();
            const ownTeam = String(currentUser?.team || '').trim();
            const admin = typeof window.isAdminSession === 'function' && window.isAdminSession();
            const team = admin ? (selected && selected !== all ? selected : ownTeam) : ownTeam;
            if (!team) throw new Error('Cannot save task because no Team is selected/assigned.');
            return team;
        }

        function taskDbPayload(row){
            // Keep this payload aligned with public.tasks, including the user-selected Scope.
            // Run the SQL migration provided with this file to add public.tasks.scope.
            // created_by / updated_by are nullable UUIDs in the current schema, while
            // the legacy public.users.id used by this app is numeric. Do not send those
            // numeric IDs into UUID columns; they can safely remain NULL.
            const projectId = (row?.projectId!==undefined && row?.projectId!==null && String(row.projectId)!=='' && Number.isFinite(Number(row.projectId)))
                ? Number(row.projectId) : null;
            const startDate = cleanDateStr(row?.start||row?.startDate);
            const planDate = cleanDateStr(row?.plan||row?.planDate);
            const actualDate = cleanDateStr(row?.actual||row?.actualDate);
            const usage = Number(row?.usageTime);
            const taskTeam = getTaskWriteTeam(row);
            return {
                team:taskTeam,
                category:String(row?.category||'').trim(),
                name:String(row?.name||'').trim(),
                items:row?.items==null?'':String(row.items),
                scope:String(row?.scope||'').trim(),
                priority:normalizeTaskPriority(row?.priority||'Medium') || 'Medium',
                pic:Array.isArray(row?.pics)?row.pics.join(', '):(row?.pic||''),
                start_date:startDate,
                plan_date:planDate,
                actual_date:actualDate || null,
                usage_time:Number.isFinite(usage) ? Math.max(0,usage) : 0,
                discipline:row?.discipline||null,
                status:row?.status||null,
                project_id:projectId,
                // These columns are nullable in public.tasks and must not receive
                // the numeric public.users.id values used by this application.
                created_by:null,
                updated_by:null,
                saved_at:row?.savedAt||new Date().toISOString()
            };
        }

        async function runTaskSave(local){
            const table=SUPABASE_TABLES.Tasks;
            const snap=sheetSyncSnapshots.Tasks||[];
            const snapById=new Map(snap.filter(r=>r?.id!==undefined&&r?.id!==null).map(r=>[String(r.id),r]));
            const localRows=Array.isArray(local)?local:[];
            const resultById=new Map();

            for(const row of localRows){
                const idKey=(row?.id!==undefined&&row?.id!==null&&String(row.id)!=='')?String(row.id):'';
                const old=snapById.get(idKey);
                row.team = getTaskWriteTeam(row);
                const payload=taskDbPayload(row);
                let result=null;

                if(idKey && old){
                    // Skip unchanged rows. This is the main save-speed improvement: an edit
                    // no longer rewrites every task in the table.
                    const oldPayload=taskDbPayload(old);
                    if(JSON.stringify(payload)===JSON.stringify(oldPayload)){
                        resultById.set(idKey,row);
                        continue;
                    }
                    result=await supabaseClient.from(table).update(payload).eq('id',Number(row.id)).select('*').single();
                }else{
                    result=await supabaseClient.from(table).insert(payload).select('*').single();
                }
                if(result.error) throw result.error;
                const mapped=mapDbTaskToApp(result.data);
                resultById.set(String(mapped.id),mapped);
            }

            // Only delete rows explicitly marked for deletion. Do not infer deletion from
            // a stale local snapshot, which can otherwise remove another user's new row.
            const pending=pendingRowDeletions.Tasks||new Set();
            const idsToDelete=snap
                .filter(r=>r?.id!==undefined&&pending.has(stableRowKey('Tasks',r)))
                .map(r=>Number(r.id)).filter(Number.isSafeInteger);
            if(idsToDelete.length){
                const {error}=await teamGuard(supabaseClient.from(table).delete().in('id',idsToDelete));
                if(error) throw error;
            }

            dailyTasks=localRows.map(row=>{
                const key=(row?.id!==undefined&&row?.id!==null)?String(row.id):'';
                return resultById.get(key)||row;
            }).filter(Boolean);
            sheetSyncSnapshots.Tasks=JSON.parse(JSON.stringify(dailyTasks));
            lastLocalSaveAt.Tasks=Date.now();
            return true;
        }

        async function runSimpleTableSave(sheetName,local){
            const table=tableForSheet(sheetName), snap=sheetSyncSnapshots[sheetName]||[];
            const snapById=new Map(snap.filter(r=>r?.id!==undefined&&r?.id!==null).map(r=>[String(r.id),r]));
            const localRows=Array.isArray(local)?local:[];
            const savedRows=[];

            // Time Off / Overtime: write to Supabase and require PostgREST to return
            // the affected row. This prevents the UI from claiming success when RLS,
            // schema, or a malformed payload prevented the database write/read-back.
            if(sheetName==='TimeOff_OT'){
                // IMPORTANT: localRows contains the entire current UI list. Do NOT
                // validate/save every existing row on every new submission. One legacy
                // or unchanged row with an incomplete value could otherwise block a
                // perfectly valid new request (the exact symptom reported by the user).
                // Only INSERT new temporary rows and UPDATE rows that actually changed.
                for(const row of localRows){
                    const idKey=(row?.id!==undefined&&row?.id!==null&&String(row.id)!=='')?String(row.id):'';
                    const old=snapById.get(idKey);
                    const isExistingDbRow = !!(old && Number.isSafeInteger(Number(row?.id)) && Number(row.id)>0);
                    const payload=dbPayloadForSheet(sheetName,row);

                    if(isExistingDbRow){
                        const oldPayload=dbPayloadForSheet(sheetName,old);
                        if(JSON.stringify(payload)===JSON.stringify(oldPayload)){
                            // Unchanged database row: leave it alone.
                            continue;
                        }
                    }

                    // Only new/changed rows need validation.
                    if(!payload || !payload.type || !payload.pic || !payload.start_date || !payload.end_date || !Number.isFinite(Number(payload.hours)) || Number(payload.hours)<=0){
                        throw new Error('Time Off/Overtime data is incomplete. Please check Type, PIC, dates and Hours.');
                    }
                    if(payload.end_date < payload.start_date){
                        throw new Error('End Date cannot be earlier than Start Date.');
                    }

                    let result;
                    if(isExistingDbRow){
                        result=await supabaseClient.from(table)
                            .update(payload)
                            .eq('id',Number(row.id))
                            .select('*')
                            .single();
                    }else{
                        result=await supabaseClient.from(table)
                            .insert(payload)
                            .select('*')
                            .single();
                    }
                    if(result.error) throw result.error;
                    if(!result.data || result.data.id===undefined || result.data.id===null){
                        throw new Error(`Supabase did not return the saved ${sheetName} row. Check RLS SELECT/INSERT policies on ${table}.`);
                    }
                    savedRows.push(mapDbTimeoffToApp(result.data));
                }

                const pending=pendingRowDeletions.TimeOff_OT||new Set();
                const idsToDelete=snap
                    .filter(r=>r?.id!==undefined&&pending.has(stableRowKey('TimeOff_OT',r)))
                    .map(r=>Number(r.id)).filter(Number.isSafeInteger);
                if(idsToDelete.length){
                    const {error}=await teamGuard(supabaseClient.from(table).delete().in('id',idsToDelete));
                    if(error) throw error;
                }

                // Read the table again so the application state exactly matches Supabase.
                const refreshed=await supabaseClient.from(table).select('*').order('id',{ascending:true});
                if(refreshed.error) throw refreshed.error;
                const authoritative=scopeRowsToTeam((refreshed.data||[]).map(mapDbTimeoffToApp));
                const requiredSavedIds=savedRows.map(r=>Number(r.id)).filter(Number.isSafeInteger);
                const returnedIds=new Set(authoritative.map(r=>Number(r.id)));
                const missingIds=requiredSavedIds.filter(id=>!returnedIds.has(id));
                if(missingIds.length){
                    throw new Error(`Saved request ID ${missingIds.join(', ')} was returned by INSERT but is not visible in a subsequent SELECT. Check the SELECT RLS policy on ${table}.`);
                }
                return authoritative;
            }

            for(const row of localRows){
                const payload=dbPayloadForSheet(sheetName,row); if(!payload) continue;
                const idKey=(row?.id!==undefined&&row?.id!==null&&String(row.id)!=='')?String(row.id):'';
                const old=snapById.get(idKey);
                let result=null;

                if(idKey && old){
                    const oldPayload=dbPayloadForSheet(sheetName,old);
                    if(JSON.stringify(payload)===JSON.stringify(oldPayload)){
                        savedRows.push(row);
                        continue;
                    }
                    result=await supabaseClient.from(table).update(payload).eq('id',Number(row.id)).select('*').single();
                }else if(sheetName==='Users'){
                    result=await supabaseClient.from(table).upsert(payload,{onConflict:'name'}).select('*').single();
                }else if(sheetName==='Capacity'){
                    result=await supabaseClient.from(table).upsert(payload,{onConflict:'team,category,task'}).select('*').single();
                }else{
                    result=await supabaseClient.from(table).insert(payload).select('*').single();
                }
                if(result.error) throw result.error;
                savedRows.push(mapSavedRow(sheetName,result.data));
            }

            // Explicit delete queue only; never delete based on a possibly stale snapshot.
            const pending=pendingRowDeletions[sheetName]||new Set();
            const idsToDelete=snap
                .filter(r=>r?.id!==undefined&&pending.has(stableRowKey(sheetName,r)))
                .map(r=>Number(r.id)).filter(Number.isSafeInteger);
            if(idsToDelete.length){
                const {error}=await teamGuard(supabaseClient.from(table).delete().in('id',idsToDelete));
                if(error) throw error;
            }
            return savedRows;
        }

        async function runSheetSave(sheetName){
            const local=sheetLatestLocal[sheetName];if(!local)return true;sheetLatestLocal[sheetName]=null;sheetSyncInFlight[sheetName]=true;lastLocalSaveAt[sheetName]=Date.now();
            try{
                if(sheetName==='Tasks') return await runTaskSave(local);
                // TimeOff_OT uses the dedicated branch inside runSimpleTableSave().
                // Do not call the removed runTimeoffOtSave() function here.
                const savedRows=await runSimpleTableSave(sheetName,local);
                if(sheetName==='Users') users=savedRows;
                else if(sheetName==='Capacity') capacityData=savedRows;
                else if(sheetName==='TimeOff_OT') timeoffOtList=savedRows;
                else if(sheetName==='Projects') projectsList=savedRows;
                sheetSyncSnapshots[sheetName]=JSON.parse(JSON.stringify(savedRows));lastLocalSaveAt[sheetName]=Date.now();return true;
            }catch(err){console.error(`Supabase Save Error [${sheetName}]:`,err);showAppNotification(`Unable to save ${sheetName} to Supabase. ${err.message||''}`,'Database Error');throw err;}
            finally{sheetSyncInFlight[sheetName]=false;}
        }

        function subscribeSupabaseRealtime(){
            if(!supabaseClient||window._bomRealtimeChannelsBound)return;
            window._bomRealtimeChannelsBound=true;
            const refresh=()=>{
                clearTimeout(window._bomRealtimeTimer);
                if(document.hidden){window._bomRealtimePending=true;return;} // PERF: no refresh while tab is hidden
                window._bomRealtimeTimer=setTimeout(()=>{
                    // Never let a realtime event immediately overwrite a local save that
                    // has just completed. This is especially important for TimeOff_OT:
                    // the INSERT can commit first, then the realtime event can arrive
                    // before the UI has finished applying the authoritative response.
                    const guardedSheets=['Tasks','TimeOff_OT','Capacity','Users','Projects'];
                    if(guardedSheets.some(name=>sheetSyncInFlight?.[name] || sheetLatestLocal?.[name])){ refresh(); return; }
                    if(guardedSheets.some(name=>Date.now()-(lastLocalSaveAt?.[name]||0)<1200)){ refresh(); return; }
                    fetchAllDataFromSheet({background:true,forceRender:true});
                },window.APP_CONFIG.REALTIME_DEBOUNCE_MS||1200);
            };
            window._bomRealtimeChannels=window._bomRealtimeChannels||[];
            Object.entries(SUPABASE_TABLES).forEach(([sheet,table])=>{
                const ch=supabaseClient.channel(`bom-team-realtime-${sheet.toLowerCase()}`)
                    .on('postgres_changes',{event:'*',schema:'public',table},refresh)
                    .subscribe(status=>{
                        const dot=document.querySelector('.realtime-dot');
                        if(!dot)return;
                        if(status==='SUBSCRIBED'){dot.style.background='#10b981';dot.title='Supabase Realtime connected';}
                        else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){dot.style.background='#f59e0b';dot.title='Supabase Realtime reconnecting';}
                    });
                window._bomRealtimeChannels.push(ch);
            });
        }

        async function fetchSheetRowsForMerge(sheetName){
            const table=tableForSheet(sheetName);
            const {data,error}=await supabaseClient.from(table).select('*');
            if(error)throw error;
            return (data||[]).map(r=>mapSavedRow(sheetName,r));
        }

        let loginMode = 'viewer';
        function setLoginMode(mode){
            loginMode = mode === 'member' ? 'member' : 'viewer';
            const sw=document.getElementById('accessSwitch');
            const creds=document.getElementById('memberCredentials');
            const user=document.getElementById('loginUsername');
            const pass=document.getElementById('loginPassword');
            const viewerBtn=document.getElementById('viewerModeBtn');
            const memberBtn=document.getElementById('memberModeBtn');
            const hint=document.getElementById('viewerHint');
            const submit=document.getElementById('loginSubmitBtn');
            sw.classList.toggle('member',loginMode==='member');
            viewerBtn.classList.toggle('active',loginMode==='viewer');
            memberBtn.classList.toggle('active',loginMode==='member');
            creds.classList.toggle('viewer-hidden',loginMode==='viewer');
            user.disabled=pass.disabled=loginMode!=='member';
            user.required=pass.required=loginMode==='member';
            hint?.classList.toggle('hidden',loginMode==='member');
            document.getElementById('viewerTeamBox')?.classList.toggle('hidden',loginMode==='member');
            submit.textContent=loginMode==='viewer'?'Continue as Viewer':'Log In';
            document.getElementById('loginError').classList.add('hidden');
        }

        // Initialize the login controls consistently on first load.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setLoginMode('viewer'), { once: true });
        } else {
            setLoginMode('viewer');
        }

        async function handleLogin(e) {
            e.preventDefault();
            const errDiv = document.getElementById('loginError');
            const btn = document.getElementById('loginSubmitBtn');
            errDiv.classList.add('hidden');
            if(btn){btn.disabled=true;btn.dataset.originalText=btn.textContent;btn.textContent='Connecting...';}
            try{
                if(!initSupabaseClient()) throw supabaseInitError || new Error('Supabase client is not available.');
                if(loginMode === 'viewer'){
                    const viewerTeam=String(document.getElementById('loginTeam')?.value||'').trim();
                    if(!viewerTeam) throw new Error('Please select the team you want to view.');
                    window.activeTeamView=viewerTeam;
                    currentUser = {id:'readonly-viewer', name:'Viewer', username:'Viewer', role:'Viewer', status:'Active', isReadOnly:true, team:viewerTeam};
                } else {
                    const uName = document.getElementById('loginUsername').value.trim();
                    const pWord = document.getElementById('loginPassword').value.trim();
                    if(!uName || !pWord) throw new Error('Please enter both username and password.');
                    const queryPromise = fetchAllRows(SUPABASE_TABLES.Users,'id');
                    const timeoutPromise = new Promise((_,reject)=>setTimeout(()=>reject(new Error('Supabase connection timed out after 10 seconds. Check network/firewall access to the configured Supabase project.')),10000));
                    const result = await Promise.race([queryPromise, timeoutPromise]);
                    if(result.error) throw result.error;
                    users = (result.data || []).map(mapDbUserToApp);
                    const found = users.find(u => String(u.name||'').toLowerCase() === uName.toLowerCase() && String(u.password??'') === pWord && String(u.status||'') === 'Active');
                    if(!found) throw new Error('Invalid username or password.');
                    if(!String(found.team||'').trim()){
                        if(found.role==='Admin') found.team='BOM C&S';
                        else throw new Error('This account is not assigned to a team. Please contact Admin.');
                    }
                    currentUser = found;
                    window.activeTeamView=String(found.team||'').trim();
                }
                const loaded = await fetchAllDataFromSheet();
                if(!loaded) throw new Error('Unable to load application data from Supabase.');
                document.getElementById('loginScreen').classList.add('hidden');
                initUserSession();
                subscribeSupabaseRealtime();
                startMultiUserAutoSync();
                applyGlobalFilters();
                switchTab('overall');
                if(currentUser?.isReadOnly) applyViewerReadOnlyMode();
            }catch(err){
                console.error('Login/Supabase Error:',err);
                errDiv.textContent = err?.message || 'Unable to connect to Supabase.';
                errDiv.classList.remove('hidden');
                currentUser=null;
            }finally{
                if(btn){btn.disabled=false;btn.textContent=loginMode==='viewer'?'Continue as Viewer':'Log In';}
            }
        }

        function applyViewerReadOnlyMode(){
            document.body.classList.add('viewer-read-only');
            // Viewer must not see or open Category Setup.
            const categoryNav = document.getElementById('nav-workload');
            if (categoryNav) categoryNav.style.display = 'none';
            const badge=document.getElementById('currentUserRoleBadge');
            if(badge) badge.textContent='Viewer';
            // Hide obvious create/edit/admin controls; retain navigation, filters and export.
            document.querySelectorAll('button,a,[role="button"]').forEach(el=>{
                const label=((el.innerText||el.getAttribute('aria-label')||el.title||'')+' '+(el.getAttribute('onclick')||'')).toLowerCase();
                if(/create|add task|new task|edit task|delete task|save task|save project|new project|add project|register|approve|reject|submit request|time.?off request|manage user|add phase|add milestone|delete project|edit project/.test(label)){
                    el.style.display='none';
                }
            });
            document.querySelectorAll('input,select,textarea').forEach(el=>{
                if(el.closest('#loginScreen')) return;
                const id=(el.id||'').toLowerCase(), name=(el.name||'').toLowerCase();
                if(/search|filter|date|month|year|week|category|status|pic|owner|priority|view|page/.test(id+' '+name)) return;
                if(el.type==='button'||el.type==='submit') return;
                el.disabled=true;
            });
            document.body.addEventListener('click',function(ev){
                if(!currentUser?.isReadOnly) return;
                const el=ev.target.closest('button,a,[role="button"]');
                if(!el) return;
                const label=((el.innerText||el.getAttribute('aria-label')||el.title||'')+' '+(el.getAttribute('onclick')||'')).toLowerCase();
                if(/create|add task|new task|edit task|delete task|save|register|approve|reject|submit request|add phase|add milestone|delete project|edit project/.test(label)){
                    ev.preventDefault();ev.stopImmediatePropagation();
                    if(typeof showAppNotification==='function') showAppNotification('Viewer access is read-only. Switch to Member and sign in to make changes.','View only');
                }
            },true);
        }


        function initUserSession() {
            if(!currentUser) return;
            document.getElementById('currentUserName').innerText = currentUser.name;
            document.getElementById('currentUserAvatar').innerText = getInitials(currentUser.name);
            document.getElementById('currentUserRoleBadge').innerText = currentUser.role;
            const timeoffPICSelect=document.getElementById('timeoffPIC');
            if(timeoffPICSelect) timeoffPICSelect.value=currentUser.name;

            const navUsers = document.getElementById('nav-users');
            const navUsersDivider = document.getElementById('nav-users-divider');
            if (currentUser.role === 'Admin' || currentUser.role === 'Team Admin') {
                navUsers.classList.remove('hidden');
                navUsersDivider.classList.remove('hidden');
            } else {
                navUsers.classList.add('hidden');
                navUsersDivider.classList.add('hidden');
            }
        }

        function logout() {
            currentUser = null;
            document.body.classList.remove('viewer-read-only');
            const categoryNav = document.getElementById('nav-workload');
            if (categoryNav) categoryNav.style.display = '';
            setLoginMode('viewer');
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginScreen').classList.remove('hidden');
            switchTab('overall');
        }

        function getInitials(name) {
            if (!name) return "US";
            return name.split(' ').map(n => n[0]).join('').substr(0, 2).toUpperCase();
        }

        function switchTab(tabId) {
            // Prevent Viewer from navigating to Category Setup even through direct calls.
            if (currentUser?.isReadOnly && tabId === 'workload') tabId = 'dashboard';
            if(typeof closeProjectRowMenus==='function') closeProjectRowMenus();
            if(typeof closeProjectHeaderFilter==='function') closeProjectHeaderFilter();
            closeWorkloadSidebar();
            document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.nav-item').forEach(el => {
                el.classList.remove('active', 'bg-indigo-600', 'text-white');
                el.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-slate-200');
            });
            document.getElementById(`tab-${tabId}`).classList.remove('hidden');
            const activeNav = document.getElementById(`nav-${tabId}`);
            if(activeNav) {
                activeNav.classList.add('active', 'bg-indigo-600', 'text-white');
                activeNav.classList.remove('text-slate-400', 'hover:bg-slate-800', 'hover:text-slate-200');
            }
            if (['dashboard','daily-tracking','my-tasks','weekly-calendar','timeoff-ot','workload'].includes(tabId) && !window._bomDefaultsInitialized) {
                setBomCurrentPeriodDefaults();
                window._bomDefaultsInitialized=true;
                window.bomFilteredTasks=dailyTasks.filter(taskPassesBomTopFilters);
            }
            if (tabId === 'dashboard') updateDashboardCharts();
            else if (tabId === 'my-tasks') renderMyTasksTable();
            else if (tabId === 'weekly-calendar') renderWeeklyCalendar();
            else if (tabId === 'projects') {
                expandedProjectRows.clear();
                collapsedProjectPhases.clear();
                projectExpandedInitialized=true;
                renderProjectsTable();
                renderGanttChart();
                setProjectView(projectCurrentView, true);
            }
            else if (tabId === 'timeoff-ot') {
                renderSaturdayMatrixTable();
                onTimeoffTypeChange();
            }
        }

        function renderPICCheckboxLists() {
            const activeUsers=(Array.isArray(users)?users:[]).filter(u=>String(u?.status||'').trim().toLowerCase()==='active');
            // Show = No users are deliberately unavailable only in the Task PIC picker.
            // Existing Project owner behavior remains unchanged.
            const activeNames=canonicalPersonList(activeUsers.map(u=>u?.name||u?.username||''));
            const taskUsers=activeNames.filter(name=>!isHiddenMember(name));
            const projectUsers=taskUsers;
            const taskWrapper = document.getElementById('taskPICsWrapper');
            const projectWrapper = document.getElementById('projectPICsWrapper');
            if (taskWrapper) {
                taskWrapper.innerHTML = taskUsers.map(name => `
                    <label class="pic-choice">
                        <input type="checkbox" class="task-pic-checkbox" value="${escapeHtml(name)}">
                        <span class="truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    </label>
                `).join('');
            }
            if (projectWrapper) {
                projectWrapper.innerHTML = projectUsers.map(name => `
                    <label class="pic-choice">
                        <input type="checkbox" class="project-pic-checkbox" value="${escapeHtml(name)}">
                        <span class="truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    </label>
                `).join('');
            }
        }

        function populateFilterOptions() {
            const picFilter = document.getElementById('globalPICFilter');
            const catFilter = document.getElementById('globalCategoryFilter');
            const activeUsers = (Array.isArray(users) ? users : []).filter(u => String(u?.status || '').trim().toLowerCase() === 'active');
            const pics = canonicalPersonList(activeUsers.map(u=>u?.name||u?.username||'')).filter(name=>!isHiddenMember(name)).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
            
            if (picFilter) picFilter.innerHTML = '<option value="ALL">-- All PICs --</option>' + pics.map(p => `<option value="${p}">${p}</option>`).join('');
            const categories = [...new Set(capacityData.map(c => c.category))].sort();
            if (catFilter) catFilter.innerHTML = '<option value="ALL">-- All Categories --</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');

            const taskCategorySelect = document.getElementById('taskCategory');
            const taskCategorySearch = document.getElementById('taskCategorySearch');
            const taskCategoryOptions = document.getElementById('taskCategoryOptions');
            if (taskCategorySelect) taskCategorySelect.innerHTML = '<option value="">-- Select Category --</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
            if (taskCategoryOptions) taskCategoryOptions.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
            if (taskCategorySearch && taskCategorySelect && !taskCategorySearch.value) taskCategorySearch.value = taskCategorySelect.value || '';
            
            const timeoffPICSelect = document.getElementById('timeoffPIC');
            if (timeoffPICSelect) {
                const timeoffPics=canonicalPersonList(activeUsers.map(u=>u?.name||u?.username||'')).filter(name=>!isHiddenMember(name)).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
                const memberOptions = timeoffPics.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
                timeoffPICSelect.innerHTML = memberOptions;
                if(currentUser && timeoffPics.some(p=>normalizePersonKey(p)===normalizePersonKey(currentUser.name))) {
                    timeoffPICSelect.value=currentUser.name;
                }
            }
            renderPICCheckboxLists();
        }

        function applyGlobalFilters() {
            applyBomUnifiedFilters();
        }

        function resetGlobalFilters() {
            resetBomTopFilters();
        }

        function formatDateLocal(dateObj) {
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function formatDateMMDDYYYY(dateStr) {
            if (!dateStr) return '-';
            const normalized = cleanDateStr(dateStr);
            const parts = String(normalized).split('-');
            if (parts.length === 3 && /^\d{4}$/.test(parts[0])) {
                return `${parts[1]}/${parts[2]}/${parts[0]}`;
            }
            return normalized || dateStr;
        }

        document.addEventListener('click', (e) => {
            if (activeFilterDropdown && !activeFilterDropdown.contains(e.target) && !e.target.classList.contains('excel-filter-btn')) {
                activeFilterDropdown.remove();
                activeFilterDropdown = null;
            }
            const sidebar = document.getElementById('workloadSidebar');
            if (!sidebar) return;
            const isOpen = !sidebar.classList.contains('translate-x-full');
            if (!isOpen) return;
            const inside = sidebar.contains(e.target);
            const calendarArea = document.getElementById('tab-weekly-calendar');
            const clickedCalendar = calendarArea && calendarArea.contains(e.target);
            if (!inside && !clickedCalendar) {
                closeWorkloadSidebar();
            }
        });

        function isDateLikeFilterColumn(table, colIndex) {
            const header = table?.querySelector('thead tr')?.cells?.[colIndex]?.innerText?.trim().toLowerCase() || '';
            if (/start|plan|actual date|actual|date|timeline|duration/.test(header)) {
                const rows = Array.from(table.querySelectorAll('tbody tr')).filter(r => !r.classList.contains('hidden'));
                const sample = rows.slice(0, 10).map(r => r.cells[colIndex]?.innerText || '').join(' ');
                return /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(sample);
            }
            return false;
        }

        function extractFilterDates(text) {
            const out = [];
            const raw = String(text || '');
            const isoMatches = raw.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
            isoMatches.forEach(v => out.push(cleanDateStr(v)));
            const usMatches = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || [];
            usMatches.forEach(v => {
                const [m,d,y] = v.split('/');
                out.push(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
            });
            return [...new Set(out.filter(Boolean))];
        }

        function formatFilterMonth(year, month) {
            return new Date(Number(year), Number(month)-1, 1).toLocaleString(undefined, { month: 'short' }) + ` ${year}`;
        }

        function buildHierarchicalDateFilter(table, colIndex, rows) {
            const dateSet = new Set();
            rows.forEach(r => extractFilterDates(r.cells[colIndex]?.innerText || '').forEach(d => dateSet.add(d)));
            const groups = {};
            [...dateSet].sort().forEach(iso => {
                const [y,m] = iso.split('-');
                if (!groups[y]) groups[y] = {};
                if (!groups[y][m]) groups[y][m] = [];
                groups[y][m].push(iso);
            });
            const selected=(advancedTableFilters[table.id]?.[colIndex]||[]).map(String);
            let html = `<div class="space-y-1" id="advDateFilterTree">`;
            Object.keys(groups).sort().forEach(year => {
                const yearId = `filter-year-${year}-${colIndex}`;
                const yearDates = Object.values(groups[year]).flat();
                const yearChecked = yearDates.length && yearDates.every(d => selected.includes(d));
                html += `<div class="border border-slate-200 rounded-md overflow-hidden">
                    <div class="flex items-center gap-2 px-2 py-1.5 bg-slate-50">
                        <input type="checkbox" class="adv-filter-group-item" data-group="year" data-year="${year}" ${yearChecked?'checked':''} onchange="toggleAdvancedDateGroup(this)">
                        <button type="button" class="flex-1 text-left flex items-center justify-between font-semibold text-slate-700" onclick="toggleFilterGroup('${yearId}', this)">
                            <span>${year}</span><i class="fa-solid fa-chevron-right text-[9px]"></i>
                        </button>
                    </div>
                    <div id="${yearId}" class="hidden p-1.5 space-y-1">`;
                Object.keys(groups[year]).sort().forEach(month => {
                    const monthId = `filter-month-${year}-${month}-${colIndex}`;
                    const monthDates = groups[year][month];
                    const monthChecked = monthDates.length && monthDates.every(d=>selected.includes(d));
                    html += `<div class="border border-slate-100 rounded-md overflow-hidden">
                        <div class="flex items-center gap-2 px-2 py-1.5">
                            <input type="checkbox" class="adv-filter-group-item" data-group="month" data-year="${year}" data-month="${month}" ${monthChecked?'checked':''} onchange="toggleAdvancedDateGroup(this)">
                            <button type="button" class="flex-1 text-left flex items-center justify-between text-slate-600 hover:bg-slate-50" onclick="toggleFilterGroup('${monthId}', this)">
                                <span>${formatFilterMonth(year, month)}</span><i class="fa-solid fa-chevron-right text-[9px]"></i>
                            </button>
                        </div>
                        <div id="${monthId}" class="hidden px-2 pb-2 space-y-0.5">`;
                    monthDates.forEach(iso => {
                        const day = Number(iso.slice(8,10));
                        html += `<label class="flex items-center gap-2 py-1">
                            <input type="checkbox" class="adv-filter-date-item" value="${iso}" ${selected.includes(iso)?'checked':''}>
                            <span>${String(day).padStart(2,'0')}/${iso.slice(5,7)}/${iso.slice(0,4)}</span>
                        </label>`;
                    });
                    html += `</div></div>`;
                });
                html += `</div></div>`;
            });
            html += `</div>`;
            return html;
        }

        function toggleAdvancedDateGroup(cb){
            const root=cb.closest('#advDateFilterTree'); if(!root)return;
            const year=cb.dataset.year, month=cb.dataset.month;
            let dates=[...root.querySelectorAll('.adv-filter-date-item')];
            if(cb.dataset.group==='month') dates=dates.filter(x=>x.value.slice(0,4)===year && x.value.slice(5,7)===month);
            else dates=dates.filter(x=>x.value.slice(0,4)===year);
            dates.forEach(d=>d.checked=cb.checked);
            root.querySelectorAll('.adv-filter-group-item').forEach(g=>{
                const gy=g.dataset.year, gm=g.dataset.month;
                let gd=[...root.querySelectorAll('.adv-filter-date-item')].filter(x=>x.value.slice(0,4)===gy);
                if(gm) gd=gd.filter(x=>x.value.slice(5,7)===gm);
                g.checked=gd.length>0 && gd.every(x=>x.checked);
                g.indeterminate=gd.some(x=>x.checked) && !g.checked;
            });
        }

        function toggleFilterGroup(id, button) {
            const el = document.getElementById(id);
            if (!el) return;
            const hidden = el.classList.toggle('hidden');
            const icon = button?.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-chevron-right', hidden);
                icon.classList.toggle('fa-chevron-down', !hidden);
            }
        }

        function decorateAdvancedFilterControls() {
            document.querySelectorAll('table[id]').forEach(table=>{
                const filterIcons=table.querySelectorAll('.excel-filter-btn');
                if(!filterIcons.length) return;
                filterIcons.forEach(icon=>{
                    const th=icon.closest('th');
                    if(!th) return;
                    const colIndex=Array.from(th.parentElement.children).indexOf(th);
                    const active=!!(advancedTableFilters[table.id] && advancedTableFilters[table.id][colIndex] && advancedTableFilters[table.id][colIndex].length);
                    icon.classList.toggle('filter-active',active);
                    icon.title=active?'Filter active':'Filter';
                    let clear=th.querySelector('.table-filter-clear-btn');
                    if(active){
                        if(!clear){
                            clear=document.createElement('i');
                            clear.className='fa-solid fa-xmark table-filter-clear-btn';
                            clear.title='Clear this column filter';
                            clear.onclick=(ev)=>{ev.stopPropagation();clearAdvancedFilter(table.id,colIndex);};
                            th.appendChild(clear);
                        }
                    }else if(clear) clear.remove();
                });
                let clearAll=table.parentElement?.parentElement?.querySelector(':scope > .table-filter-clear-all');
                if(!clearAll){
                    clearAll=document.createElement('button');
                    clearAll.type='button';
                    clearAll.className='table-filter-clear-all';
                    clearAll.innerHTML='<i class="fa-solid fa-filter-circle-xmark mr-1"></i>Clear Filter All';
                    clearAll.onclick=()=>clearAllAdvancedFilters(table.id);
                    const wrapper=table.parentElement?.parentElement;
                    if(wrapper) wrapper.insertBefore(clearAll,table.parentElement);
                }
                const anyActive=Object.values(advancedTableFilters[table.id]||{}).some(v=>Array.isArray(v)&&v.length);
                clearAll.style.display=anyActive?'inline-flex':'none';
            });
        }

        function getAdvancedFilterRows(table){
            const rows=Array.from(table?.querySelector('tbody')?.querySelectorAll('tr')||[]);
            return table?.id==='table-gantt' ? rows.filter(r=>!r.classList.contains('gantt-hours-used-row')) : rows;
        }
        function getTableCellFilterText(cell){
            if(!cell) return '';
            const select=cell.querySelector('select');
            if(select) return String(select.options?.[select.selectedIndex]?.textContent ?? select.value ?? '').trim();
            const input=cell.querySelector('input');
            if(input) return String(input.value ?? '').trim();
            const textarea=cell.querySelector('textarea');
            if(textarea) return String(textarea.value ?? '').trim();
            return String(cell.innerText||'').trim().replace(/\s+/g,' ');
        }

        function recomputeAdvancedTableFilter(tableId){
            const table=document.getElementById(tableId); if(!table)return;
            const rows=getAdvancedFilterRows(table);
            const filters=advancedTableFilters[tableId]||{};
            rows.forEach(r=>{
                if(!r.cells.length)return;
                let visible=true;
                Object.entries(filters).forEach(([col,vals])=>{
                    if(!visible || !vals?.length)return;
                    const idx=Number(col), text=getTableCellFilterText(r.cells[idx]);
                    if(isDateLikeFilterColumn(table,idx)){
                        visible=extractFilterDates(text).some(d=>vals.includes(d));
                    }else{
                        visible=vals.includes(text);
                    }
                });
                r.classList.toggle('hidden',!visible);
            });
            decorateAdvancedFilterControls();
        }

        function openAdvancedFilter(tableId, colIndex) {
            closeActiveFilter();
            const table=document.getElementById(tableId); if(!table)return;
            const rows=getAdvancedFilterRows(table).filter(r=>!r.classList.contains('hidden'));
            const isDateFilter=isDateLikeFilterColumn(table,colIndex);
            const existing=(advancedTableFilters[tableId]?.[colIndex]||[]).map(String);
            const dropdown=document.createElement('div');
            dropdown.className='filter-dropdown text-xs font-normal';
            dropdown.innerHTML=`
                <div class="mb-2 border-b pb-1 flex justify-between items-center">
                    <span class="font-bold">Filter</span>
                    <button type="button" class="text-slate-400 hover:text-slate-600" onclick="closeActiveFilter()">×</button>
                </div>
                <input type="text" class="w-full mb-2 px-2 py-1 border border-slate-300 rounded text-xs" placeholder="Search..." oninput="filterDropdownItems(this)">
                <div class="max-h-56 overflow-y-auto custom-scrollbar" id="filterListContainer"></div>
                <div class="mt-2 flex justify-end space-x-2">
                    <button type="button" class="px-2 py-1 rounded bg-orange-500 text-white text-xs font-semibold" onclick="applyAdvancedFilter('${tableId}', ${colIndex})">Apply</button>
                    <button type="button" class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs" onclick="clearAdvancedFilter('${tableId}', ${colIndex})">Clear</button>
                </div>`;
            const listDiv=dropdown.querySelector('#filterListContainer');
            if(isDateFilter){
                listDiv.innerHTML=buildHierarchicalDateFilter(table,colIndex,rows);
                listDiv.querySelectorAll('.adv-filter-date-item').forEach(c=>c.checked=existing.includes(c.value));
            }else{
                const values=new Set(); rows.forEach(r=>{const c=r.cells[colIndex];if(c)values.add(getTableCellFilterText(c));});
                listDiv.innerHTML=Array.from(values).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'})).map(v=>`<label class="flex items-center space-x-2 py-0.5"><input type="checkbox" class="adv-filter-item" value="${escapeHtml(v)}" ${existing.includes(v)?'checked':''}><span>${escapeHtml(v||'(Blank)')}</span></label>`).join('');
            }
            activeFilterDropdown=dropdown;
            document.body.appendChild(dropdown);
            const headerCell=table.tHead?.rows?.[0]?.cells?.[colIndex];
            const icon=headerCell?.querySelector('.excel-filter-btn') || headerCell || table;
            const rect=icon.getBoundingClientRect(), w=240, h=Math.min(dropdown.scrollHeight||360,420);
            // Anchor to the clicked header icon/cell like Excel, not to the nth filter icon in the table.
            let left=Math.max(8,Math.min(rect.left,window.innerWidth-w-8));
            let top=rect.bottom+3;
            if(top+h>window.innerHeight-8) top=Math.max(8,rect.top-h-3);
            dropdown.style.left=Math.round(left)+'px'; dropdown.style.top=Math.round(top)+'px'; dropdown.style.zIndex='2147483647';
        }

        function closeActiveFilter(){ if(activeFilterDropdown){activeFilterDropdown.remove();activeFilterDropdown=null;} }
        function filterDropdownItems(inputEl){
            const q=inputEl.value.toLowerCase();
            activeFilterDropdown?.querySelectorAll('#filterListContainer label').forEach(l=>l.style.display=l.innerText.toLowerCase().includes(q)?'':'none');
            activeFilterDropdown?.querySelectorAll('#filterListContainer > div, #filterListContainer > .border').forEach(g=>g.style.display=g.innerText.toLowerCase().includes(q)?'':'none');
        }
        function applyAdvancedFilter(tableId,colIndex){
            if(!activeFilterDropdown)return;
            const dateChecked=[...activeFilterDropdown.querySelectorAll('.adv-filter-date-item:checked')].map(i=>i.value);
            const normalChecked=[...activeFilterDropdown.querySelectorAll('.adv-filter-item:checked')].map(i=>i.value);
            const selected=dateChecked.length?dateChecked:normalChecked;
            advancedTableFilters[tableId]=advancedTableFilters[tableId]||{};
            if(selected.length) advancedTableFilters[tableId][colIndex]=selected.slice(); else delete advancedTableFilters[tableId][colIndex];
            closeActiveFilter();
            recomputeAdvancedTableFilter(tableId);
        }
        function clearAdvancedFilter(tableId,colIndex){
            if(advancedTableFilters[tableId]){
                delete advancedTableFilters[tableId][colIndex];
                if(!Object.keys(advancedTableFilters[tableId]).length) delete advancedTableFilters[tableId];
            }
            closeActiveFilter();
            recomputeAdvancedTableFilter(tableId);
        }
        function clearAllAdvancedFilters(tableId){
            delete advancedTableFilters[tableId];
            closeActiveFilter();
            const table=document.getElementById(tableId);
            getAdvancedFilterRows(table).forEach(r=>r.classList.remove('hidden'));
            decorateAdvancedFilterControls();
        }

        const CAPACITY_SCOPES = ["In BOM's scope","Out of BOM's scope","RND process","Compliance","Projects","New Go Tracking"];
        function renderCapacityTable() {
            const tbody = document.getElementById('capacityTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (!capacityData.length) { tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400 italic">No capacity data.</td></tr>`; return; }
            capacityData.forEach((item,index)=>{
                const tr=document.createElement('tr');
                tr.className='hover:bg-slate-50 transition border-b border-slate-100';
                const scope=CAPACITY_SCOPES.includes(String(item.scope||'')) ? String(item.scope) : (item.scope||CAPACITY_SCOPES[0]);
                tr.innerHTML=`
                    <td class="py-2.5 px-4 text-center font-semibold text-slate-400">${index+1}</td>
                    <td class="py-2.5 px-4 font-bold text-slate-800">${escapeHtml(item.category||'')}</td>
                    <td class="py-2.5 px-4 text-slate-700">${escapeHtml(item.task||'')}</td>
                    <td class="py-2.5 px-2 text-center"><select onchange="updateCapacityField(${item.id},'scope',this.value)" class="w-full max-w-[190px] px-2 py-1 bg-white border border-slate-300 rounded text-[11px]">${[...new Set([...CAPACITY_SCOPES,scope].filter(Boolean))].map(x=>`<option value="${escapeHtml(x)}" ${x===scope?'selected':''}>${escapeHtml(x)}</option>`).join('')}</select></td>
                    <td class="py-2.5 px-2 text-center text-[11px] font-semibold text-slate-600">${escapeHtml(item.team||"—")}</td>
                    <td class="py-2.5 px-2 text-center">
                        <button type="button" onclick="openCapacityCategoryModal(${item.id})" class="text-slate-400 hover:text-indigo-600 mr-2" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button type="button" onclick="deleteCapacityItem(${item.id})" class="text-slate-400 hover:text-red-600" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </td>`;
                tbody.appendChild(tr);
            });
        }
        async function updateCapacityField(id, field, val) {
            const item=capacityData.find(c=>String(c.id)===String(id)); if(!item) return;
            if(field==='workload') return; // Workload is calculated from Daily Tracking.
            if(field==='scope'){ item.scope=String(val||'').trim()||item.scope||CAPACITY_SCOPES[0]; }
            renderCapacityTable(); await saveSheetData('Capacity',capacityData); populateFilterOptions();
        }
        async function deleteCapacityItem(id){
            const item=capacityData.find(c=>String(c.id)===String(id));
            if(!item) return;
            const ok=await showAppConfirm(`Delete capacity item "${item.category} / ${item.task}"?`);
            if(!ok) return;
            pendingRowDeletions.Capacity.add(stableRowKey('Capacity',item));
            capacityData=capacityData.filter(c=>String(c.id)!==String(id));
            renderCapacityTable();
            try{
                await saveSheetData('Capacity',capacityData);
                pendingRowDeletions.Capacity.delete(stableRowKey('Capacity',item));
                populateFilterOptions();
                restoreAdvancedTableFilters();
                showAppNotification('Capacity item deleted.');
            }catch(err){
                pendingRowDeletions.Capacity.delete(stableRowKey('Capacity',item));
                showAppNotification(`Unable to delete capacity item. ${err?.message||err||'Unknown error'}`,'Delete Error');
                await fetchAllDataFromSheet({background:false});
            }
        }
        function normalizeCapacityImportHeader(value) {
            return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
        }

        function parseCapacityNumber(value) {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            const raw = String(value ?? '').trim();
            if (!raw) return NaN;
            // Accept both 0.25 and 0,25 for users with Vietnamese/European Excel settings.
            const normalized = raw.replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.');
            const n = Number(normalized);
            return Number.isFinite(n) ? n : NaN;
        }

        function handleCapacityImport(e) {
            const file=e.target.files?.[0]; if(!file) return;
            const reader=new FileReader();
            reader.onload=async evt=>{
                try {
                    const wb=XLSX.read(new Uint8Array(evt.target.result),{type:'array'});
                    const sheet=wb.Sheets[wb.SheetNames[0]];
                    if(!sheet) throw new Error('The selected file does not contain a worksheet.');
                    const rawRows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true});
                    if(!rawRows.length) throw new Error('The selected file is empty.');

                    const rows=rawRows.map((row,rowIndex)=>{
                        const normalized={};
                        Object.keys(row).forEach(k=>{ normalized[normalizeCapacityImportHeader(k)]=row[k]; });
                        const category=String(normalized.category ?? '').trim();
                        const task=String(normalized.taskname ?? normalized.task ?? '').trim();
                        const scope=String(normalized.scope ?? '').trim();
                        const workload=parseCapacityNumber(normalized.workloadhour ?? normalized.workload ?? normalized.hours);
                        return { excelRow: rowIndex+2, category, task, scope, workload, team:String(normalized.team ?? '').trim() };
                    });

                    const errors=[];
                    const seen=new Set();
                    // MULTI-TEAM: an import may only ever touch ONE team: the team of the signed-in member
                    // (or the team an Admin has selected in the sidebar).
                    const importTeam=getWriteTeam();
                    if(!importTeam) throw new Error('Select a specific Team in the sidebar before importing Category / Task Name. An import always belongs to exactly one team.');
                    rows.forEach(r=>{ if(r.team && normTeam(r.team)!==normTeam(importTeam)) errors.push(`Row ${r.excelRow}: Team "${r.team}" is not your team ("${importTeam}"). You can only import data for your own team.`); });
                    rows.forEach(r=>{
                        if(!r.category) errors.push(`Row ${r.excelRow}: Category is required.`);
                        if(!r.task) errors.push(`Row ${r.excelRow}: Task Name is required.`);
                        if(!CAPACITY_SCOPES.includes(r.scope)) errors.push(`Row ${r.excelRow}: Scope must be one of: ${CAPACITY_SCOPES.join(', ')}.`);
                        if(!Number.isFinite(r.workload) || r.workload < 0) errors.push(`Row ${r.excelRow}: Workload (Hour) must be a number >= 0.`);
                        const key=`${r.category.toLowerCase()}|||${r.task.toLowerCase()}`;
                        if(r.category && r.task){
                            if(seen.has(key)) errors.push(`Row ${r.excelRow}: Duplicate Category + Task Name in the import file.`);
                            seen.add(key);
                        }
                    });
                    if(errors.length){
                        const shown=errors.slice(0,12);
                        const more=errors.length>12 ? `\n...and ${errors.length-12} more error(s).` : '';
                        throw new Error(shown.join('\n')+more);
                    }

                    const importedCount=await importCapacityForTeam(importTeam, rows);
                    if(importedCount===null) return;
                    renderCapacityTable();
                    populateFilterOptions();
                    restoreAdvancedTableFilters();
                    showAppNotification(`${importedCount} Category / Task Name item(s) imported for team "${importTeam}". Other teams were not changed.`);
                } catch(err){
                    showAppNotification(err.message || 'Capacity import failed.','Import Error');
                } finally{
                    e.target.value='';
                }
            };
            reader.readAsArrayBuffer(file);
        }
        function openCapacityCategoryModal(editId=null) {
            const modal=document.getElementById('capacityCategoryModal'); const select=document.getElementById('capacityCategorySelect');
            const cats=[...new Set(capacityData.map(c=>String(c.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
            select.innerHTML='<option value="">-- Select existing category --</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')+'<option value="__NEW__">+ Create new Category</option>';
            document.getElementById('capacityEditId').value=editId||'';
            document.getElementById('capacityNewCategory').value='';
            if(editId!==null){ const item=capacityData.find(c=>String(c.id)===String(editId)); if(item){
                if(!Array.from(select.options).some(o=>String(o.value)===String(item.category||''))){ select.insertBefore(new Option(String(item.category||''),String(item.category||'')),select.querySelector('option[value="__NEW__"]')); }
                select.value=item.category; document.getElementById('capacityTaskName').value=item.task||''; {const sc=document.getElementById('capacityScope');const v=String(item.scope||'').trim();if(v&&!Array.from(sc.options).some(o=>o.value===v))sc.add(new Option(v,v));sc.value=v||CAPACITY_SCOPES[0];}  document.getElementById('capacityModalTitle').innerText='Edit Category';} }
            else {document.getElementById('capacityTaskName').value=''; document.getElementById('capacityScope').value=CAPACITY_SCOPES[0]; document.getElementById('capacityWorkload').value='0'; document.getElementById('capacityModalTitle').innerText='Add Capacity';}
            onCapacityCategoryModeChange(); modal.classList.remove('opacity-0','pointer-events-none'); document.body.classList.add('modal-active');
        }
        function closeCapacityCategoryModal(){document.getElementById('capacityCategoryModal').classList.add('opacity-0','pointer-events-none');document.body.classList.remove('modal-active');}
        function onCapacityCategoryModeChange(){const isNew=document.getElementById('capacityCategorySelect').value==='__NEW__';const input=document.getElementById('capacityNewCategory');input.classList.toggle('hidden',!isNew);input.required=isNew;}
        async function saveCapacityCategory(e){
            e.preventDefault(); const editId=document.getElementById('capacityEditId').value; const sel=document.getElementById('capacityCategorySelect').value;
            const category=(sel==='__NEW__'?document.getElementById('capacityNewCategory').value:sel).trim(); const task=document.getElementById('capacityTaskName').value.trim(); const scope=document.getElementById('capacityScope').value; const workload=0;
            if(!category||!task||!String(scope||'').trim()){
                validateRequiredFormFields(document.getElementById('capacityCategoryForm'));
                return;
            }
            const duplicate=capacityData.some(c=>String(c.id)!==String(editId)&&String(c.category||'').trim().toLowerCase()===category.toLowerCase()&&String(c.task||'').trim().toLowerCase()===task.toLowerCase());
            if(duplicate){showAppNotification('This Category + Task Name already exists.','Validation');return;}
            const createFingerprint = !editId ? makeCreateFingerprint('capacity',[category,task,scope,workload]) : '';
            if(!beginFormSave('capacityCategoryForm', createFingerprint)) return;
            try {
            const oldItem = editId ? capacityData.find(c=>String(c.id)===String(editId)) : null;
            const oldCategory = String(oldItem?.category||'').trim();
            const oldTaskName = String(oldItem?.task||'').trim();
            if(editId){const item=capacityData.find(c=>String(c.id)===String(editId)); if(item){item.category=category;item.task=task;item.scope=scope;item.workload=workload;}}
            else {const nextId=capacityData.reduce((m,c)=>Math.max(m,Number(c.id)||0),0)+1;capacityData.push({id:nextId,category,task,scope,workload});}
            // When Task Name is renamed in Category Setup, propagate the new name to all
            // existing tasks using the old Category + Task Name pair.
            if(editId && oldTaskName && oldTaskName !== task){
                const oldCatKey=normalizeWorkloadKey(oldCategory), oldTaskKey=normalizeWorkloadKey(oldTaskName);
                dailyTasks=dailyTasks.map(t=>{
                    if(normalizeWorkloadKey(t.category)===oldCatKey && normalizeWorkloadKey(t.name)===oldTaskKey){
                        return calculateTaskMetadata({...t,name:task});
                    }
                    return t;
                });
            }
            if(editId && oldTaskName && oldTaskName !== task) await saveSheetData('Tasks',dailyTasks);
            recalculateCapacityWorkloadsFromTasks();
            await saveSheetData('Capacity',capacityData);
            renderCapacityTable();populateFilterOptions();restoreAdvancedTableFilters();closeCapacityCategoryModal();showAppNotification('Capacity saved successfully.');
            } catch(err) {
                forgetCreateFingerprint(createFingerprint);
                console.error('Capacity save error:', err);
                showAppNotification(`Unable to save capacity. ${err?.message || err || 'Unknown error'}`, 'Save Error');
            } finally {
                endFormSave('capacityCategoryForm');
            }
        }

        /* ===== Unified page filters / actions ===== */
        const bomTopFilterState = { Year:new Set(), Month:new Set(), Week:new Set(), Category:new Set(), Member:new Set(), Status:new Set() };
        const ganttFilterState={Project:new Set(),Start:new Set(),Plan:new Set(),Actual:new Set(),Status:new Set(),Progress:new Set(),Owner:new Set()};
        const ganttFilterDraftState={Project:new Set(),Owner:new Set(),Status:new Set()};
        const expandedGanttProjects = new Set();
        function toggleGanttProjectHours(projectId){ const key=String(projectId); if(expandedGanttProjects.has(key)) expandedGanttProjects.delete(key); else expandedGanttProjects.add(key); renderGanttChart(); }
        function getGanttCalculatedProgress(p){
            if(String(p?.status||'').trim().toLowerCase()==='done') return 100;
            const start=cleanDateStr(p?.startDate), plan=cleanDateStr(p?.dueDate), actual=cleanDateStr(p?.actualDate);
            if(!start||!plan||plan<start) return Math.max(0,Math.min(100,Number(p?.progress)||0));
            if(actual){
                if(actual<=start) return 0;
                if(actual>=plan) return 100;
                const total=Math.max(1,Math.round((new Date(plan)-new Date(start))/86400000)+1);
                const used=Math.max(0,Math.min(total,Math.round((new Date(actual)-new Date(start))/86400000)+1));
                return Math.max(0,Math.min(100,Math.round(used/total*100)));
            }
            const today=cleanDateStr(formatDateLocal(new Date()));
            if(today<=start) return 0;
            if(today>=plan) return 100;
            const total=Math.max(1,Math.round((new Date(plan)-new Date(start))/86400000)+1);
            const used=Math.max(0,Math.min(total,Math.round((new Date(today)-new Date(start))/86400000)+1));
            return Math.max(0,Math.min(100,Math.round(used/total*100)));
        }
        function getGanttProjectDailyStatuses(p){
            const pid=String(p?.id ?? '');
            const pname=String(p?.name || '').trim();
            const statuses=new Set();
            dailyTasks.forEach(t=>{
                if(!isProjectHoursTask(t)) return;
                const linked=pid && String(t.projectId ?? '')===pid;
                const sameName=pname && String(t.items || '').trim()===pname;
                if(linked || sameName){
                    const st=String(t.status || '').trim();
                    if(st) statuses.add(st);
                }
            });
            return [...statuses];
        }
        function getGanttFilterUniverse(key){
            const v=new Set();
            projectsList.forEach(p=>{
                const progress=getGanttCalculatedProgress(p);
                if(key==='Project'&&p.name)v.add(String(p.name));
                if(key==='Start'&&p.startDate)v.add(formatDateMMDDYYYY(p.startDate));
                if(key==='Plan'&&p.dueDate)v.add(formatDateMMDDYYYY(p.dueDate));
                if(key==='Actual'&&p.actualDate)v.add(formatDateMMDDYYYY(p.actualDate));
                if(key==='Status'){
                    const ps=calculateProjectOverallStatus(p); if(ps) v.add(String(ps));
                    (p.phases||[]).forEach(ph=>{const sm=projectPhaseSummary(ph,p); if(sm.status)v.add(String(sm.status)); (ph.tasks||[]).forEach(t=>{const ts=calculateProjectTaskStatus(t); if(ts)v.add(String(ts));});});
                    (p.tasks||[]).forEach(t=>{const ts=calculateProjectTaskStatus(t); if(ts)v.add(String(ts));});
                }
                if(key==='Progress')v.add(`${progress}%`);
                if(key==='Owner')(Array.isArray(p.owners)?p.owners:String(p.owner||'').split(',')).map(x=>String(x).trim()).filter(Boolean).forEach(x=>v.add(x));
            });
            // Always expose every Daily Tracking status in the Gantt Status filter,
            // even when the current Gantt period has no linked Project Processing row.
            if(key==='Status'){
                ['Completed','Working','Overdue','Not Started'].forEach(st=>v.add(st));
                dailyTasks.forEach(t=>{const st=String(t.status||'').trim();if(st)v.add(st);});
            }
            return [...v].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
        }
        function ganttFilterValues(key,p){
            const progress=getGanttCalculatedProgress(p);
            if(key==='Project')return[String(p.name||'')];
            if(key==='Start')return[p.startDate?formatDateMMDDYYYY(p.startDate):''];
            if(key==='Plan')return[p.dueDate?formatDateMMDDYYYY(p.dueDate):''];
            if(key==='Actual')return[p.actualDate?formatDateMMDDYYYY(p.actualDate):''];
            if(key==='Status'){const vals=[calculateProjectOverallStatus(p)]; (p.phases||[]).forEach(ph=>{const sm=projectPhaseSummary(ph,p); if(sm.status)vals.push(sm.status); (ph.tasks||[]).forEach(t=>vals.push(calculateProjectTaskStatus(t)));}); (p.tasks||[]).forEach(t=>vals.push(calculateProjectTaskStatus(t))); return vals.map(String);}
            if(key==='Progress')return[`${progress}%`];
            if(key==='Owner')return(Array.isArray(p.owners)?p.owners:String(p.owner||'').split(',')).map(x=>String(x).trim()).filter(Boolean);
            return[];
        }

        function getIsoWeekRange(year, week) {
            // BOM/Vietnam reporting weeks follow Monday-Sunday.
            // Example: 2026 W40 = 09/28 - 10/04.
            const y = Number(year), w = Number(week);
            if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1 || w > 53) return null;
            const jan4 = new Date(y, 0, 4);
            const jan4Day = (jan4.getDay() + 6) % 7; // Mon=0 ... Sun=6
            const monday = new Date(y, 0, 4 - jan4Day + (w - 1) * 7);
            const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
            return { start: formatDateLocal(monday), end: formatDateLocal(sunday) };
        }

        function getTaskMonthNumber(task) {
            // Reporting Month follows the ISO week: a week belongs to the
            // calendar month containing its Sunday. Example: W40 (09/27-10/03)
            // belongs to October.
            const rawWeek = task.week ?? task.Week;
            const rawYear = task.year ?? task.Year;
            let week = null;
            if (rawWeek !== undefined && rawWeek !== null && String(rawWeek).trim() !== '') {
                const n = parseInt(String(rawWeek).replace(/[^0-9]/g,''), 10);
                if (n > 0) week = n;
            }
            const sourceDate = cleanDateStr(task.start || task.plan || task.actual || '');
            if (!week && sourceDate) week = getIsoWeekNumber(sourceDate);
            if (week) {
                let year = Number(rawYear);
                if (!Number.isFinite(year) || year < 2000) {
                    if (sourceDate) year = Number(sourceDate.slice(0,4));
                    else year = new Date().getFullYear();
                }
                const range = getIsoWeekRange(year, week);
                if (range) return Number(range.end.slice(5,7));
            }
            const raw = task.month ?? task.Month;
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                const n = parseInt(String(raw).replace(/[^0-9]/g,''), 10);
                if (n >= 1 && n <= 12) return n;
                const names = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
                const nameKey = String(raw).trim().toLowerCase();
                if (names[nameKey]) return names[nameKey];
            }
            return sourceDate ? Number(sourceDate.slice(5,7)) : null;
        }

        function getIsoWeekNumber(dateStr) {
            // Vietnam/BOM week numbering: Monday-Sunday (ISO week).
            // Example: 2026-09-28 through 2026-10-04 is W40.
            if (!dateStr) return null;
            const d = new Date(dateStr + 'T00:00:00');
            if (isNaN(d.getTime())) return null;
            const target = new Date(d);
            const dayNr = (target.getDay() + 6) % 7;
            target.setDate(target.getDate() - dayNr + 3);
            const firstThursday = new Date(target.getFullYear(), 0, 4);
            return 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
        }

        function getTaskWeekNumber(task) {
            const raw = task.week ?? task.Week;
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                const n = parseInt(String(raw).replace(/[^0-9]/g,''), 10);
                if (n > 0) return n;
            }
            return getIsoWeekNumber(cleanDateStr(task.start || task.plan || task.actual || ''));
        }

        function bomTaskValues(key, task) {
            const pics = reportableTaskPICs(task);
            if (key === 'Member') return pics;
            if (key === 'Year') {
                const d = cleanDateStr(task.start || task.plan || task.actual || '');
                const m = String(d).match(/(20\d{2})/); return m ? [m[1]] : (task.year != null ? [String(task.year)] : []);
            }
            if (key === 'Month') { const month = getTaskMonthNumber(task); return month ? [String(month)] : []; }
            if (key === 'Week') { const week = getTaskWeekNumber(task); return week ? [String(week)] : []; }
            if (key === 'Category') return [task.category].filter(Boolean).map(String);
            if (key === 'Status') return [task.status].filter(Boolean).map(String);
            return [];
        }

        function getBomFilterUniverse(key) {
            if (key === 'Status') dailyTasks.forEach(t=>calculateTaskMetadata(t));
            if (key === 'Month') return Array.from({length:12}, (_,i)=>String(i+1));
            if (key === 'Year' && Array.isArray(window.__taskYearUniverse) && window.__taskYearUniverse.length) return window.__taskYearUniverse.slice();
            const values = new Set();
            if (key === 'Week') {
                const selectedMonths = bomTopFilterState.Month;
                dailyTasks.forEach(t => {
                    const month = getTaskMonthNumber(t);
                    if (selectedMonths.size && (!month || !selectedMonths.has(String(month)))) return;
                    const week = getTaskWeekNumber(t);
                    if (week) values.add(String(week));
                });
            } else {
                dailyTasks.forEach(t => bomTaskValues(key,t).forEach(v=>values.add(String(v))));
            }
            return [...values].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
        }

        function bomFilterBarOptions(bar, key) {
            const menu=bar.querySelector('.bom-multi-menu');
            if (!menu) return;
            const isGantt=Object.prototype.hasOwnProperty.call(ganttFilterState,key);
            const state=isGantt?ganttFilterState:bomTopFilterState;
            const rawSelected=state?.[key];
            const selected=rawSelected instanceof Set ? rawSelected : new Set(Array.isArray(rawSelected)?rawSelected:(rawSelected==null||rawSelected===''?[]:[String(rawSelected)]));
            const values=(isGantt?getGanttFilterUniverse(key):getBomFilterUniverse(key)) || [];
            menu.innerHTML=`<input type="search" placeholder="Search ${key}..." oninput="filterBomOptionSearch(this)">${values.map(v=>`
                <label class="bom-multi-option" data-label="${String(v).toLowerCase()}">
                    <input type="checkbox" value="${escapeHtml(String(v))}" ${selected.has(String(v))?'checked':''} onchange="changeBomTopFilter('${key}', this)">
                    <span>${escapeHtml(String(v))}</span>
                </label>`).join('')}
                <div class="flex gap-1 pt-2 border-t mt-1">
                    <button type="button" class="text-[10px] px-2 py-1 bg-slate-100 rounded" onclick="selectAllBomFilter('${key}',true)">All</button>
                    <button type="button" class="text-[10px] px-2 py-1 bg-slate-100 rounded" onclick="selectAllBomFilter('${key}',false)">Clear</button>
                </div>`;
        }
        function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
        function toggleBomFilter(btn){
            const menu=btn.parentElement.querySelector('.bom-multi-menu');
            document.querySelectorAll('.bom-multi-menu').forEach(m=>{if(m!==menu)m.classList.add('hidden')});
            menu.classList.toggle('hidden');
            if(!menu.classList.contains('hidden')){
                bomFilterBarOptions(btn.parentElement,btn.parentElement.dataset.filterKey);
                const rect = btn.getBoundingClientRect();
                const menuWidth = 240;
                const menuHeight = Math.min(menu.scrollHeight || 280, 280);
                let left = rect.left;
                let top = rect.bottom + 4;
                if(left + menuWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - menuWidth - 8);
                if(top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 4);
                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
                menu.style.zIndex = '2147483647';
            }
        }
        function filterBomOptionSearch(input){
            const q=input.value.toLowerCase();
            input.parentElement.querySelectorAll('.bom-multi-option').forEach(o=>o.style.display=o.dataset.label.includes(q)?'flex':'none');
        }
        function changeBomTopFilter(key, cb){
            if(Object.prototype.hasOwnProperty.call(ganttFilterState,key)){ if(cb.checked)ganttFilterState[key].add(cb.value);else ganttFilterState[key].delete(cb.value);updateBomFilterButtons();renderGanttChart();return;}
            if(cb.checked) bomTopFilterState[key].add(cb.value); else bomTopFilterState[key].delete(cb.value);
            if (key === 'Week') syncBomMonthToSelectedWeek();
            if (key === 'Month') {
                const availableWeeks = new Set(getBomFilterUniverse('Week'));
                [...bomTopFilterState.Week].forEach(w => { if (!availableWeeks.has(String(w))) bomTopFilterState.Week.delete(String(w)); });
                document.querySelectorAll('[data-filter-key="Week"]').forEach(bar => bomFilterBarOptions(bar,'Week'));
            }
            updateBomFilterButtons();
            if (key === 'Year') { window.__taskYearsExplicit = true; ensureTaskYearsLoaded().then(()=>applyBomUnifiedFilters()); return; }
            applyBomUnifiedFilters();
        }
        function selectAllBomFilter(key, all){
            if(Object.prototype.hasOwnProperty.call(ganttFilterState,key)){ganttFilterState[key].clear();if(all)getGanttFilterUniverse(key).forEach(v=>ganttFilterState[key].add(String(v)));document.querySelectorAll(`[data-filter-key="${key}"]`).forEach(bar=>bomFilterBarOptions(bar,key));updateBomFilterButtons();renderGanttChart();return;}
            bomTopFilterState[key].clear();
            if(all) getBomFilterUniverse(key).forEach(v=>bomTopFilterState[key].add(String(v)));
            if (key === 'Month') {
                const availableWeeks = new Set(getBomFilterUniverse('Week'));
                [...bomTopFilterState.Week].forEach(w => { if (!availableWeeks.has(String(w))) bomTopFilterState.Week.delete(String(w)); });
                document.querySelectorAll('[data-filter-key="Week"]').forEach(bar=>bomFilterBarOptions(bar,'Week'));
            }
            document.querySelectorAll(`[data-filter-key="${key}"]`).forEach(bar=>bomFilterBarOptions(bar,key));
            updateBomFilterButtons();
            if (key === 'Year') { window.__taskYearsExplicit = true; ensureTaskYearsLoaded().then(()=>applyBomUnifiedFilters()); return; }
            applyBomUnifiedFilters();
        }
        function updateBomFilterButtons(){
            document.querySelectorAll('[data-bom-filter-bar="1"] .bom-multi').forEach(bar=>{
                const key=bar.dataset.filterKey;
                const state=Object.prototype.hasOwnProperty.call(ganttFilterState,key)?ganttFilterState:bomTopFilterState;
                const rawSelected=state?.[key];
                const selected=rawSelected instanceof Set ? rawSelected : new Set(Array.isArray(rawSelected)?rawSelected:(rawSelected==null||rawSelected===''?[]:[String(rawSelected)]));
                const btn=bar.querySelector('.bom-multi-btn');
                if(!btn)return;
                const values=Array.from(selected).map(String);
                const label=values.length ? `${key}: ${values.join(', ')}` : key;
                btn.innerHTML=`<span class="truncate max-w-[220px]" title="${escapeHtml(label)}">${escapeHtml(label)}</span><i class="fa-solid fa-chevron-down text-[9px] ml-auto shrink-0"></i>`;
            });
        }
        function setBomCurrentPeriodDefaults(){
            // The shared filters on Dashboard / Daily Tracking / My Task / Calendar /
            // Workload always start on the actual current Year / Month / ISO Week.
            // Project Management intentionally does not use these filters.
            const now=new Date();
            const currentYear=String(now.getFullYear());
            const currentWeekNo=getIsoWeekNumber(formatDateLocal(now));
            const currentWeek=String(currentWeekNo);
            const weekRange=getIsoWeekRange(now.getFullYear(), currentWeekNo);
            const currentMonth=String(weekRange ? Number(weekRange.end.slice(5,7)) : now.getMonth()+1);
            bomTopFilterState.Year.clear();
            bomTopFilterState.Month.clear();
            bomTopFilterState.Week.clear();
            bomTopFilterState.Year.add(currentYear);
            bomTopFilterState.Month.add(currentMonth);
            bomTopFilterState.Week.add(currentWeek);
            document.querySelectorAll('.bom-multi').forEach(bar=>{
                if(bar.closest('#tab-projects')) return;
                bomFilterBarOptions(bar,bar.dataset.filterKey);
            });
            updateBomFilterButtons();
        }
        function syncBomMonthToSelectedWeek(){
            const weeks=[...bomTopFilterState.Week];
            if(weeks.length!==1) return;
            const years=[...bomTopFilterState.Year];
            const year=years.length===1?Number(years[0]):new Date().getFullYear();
            const range=getIsoWeekRange(year,Number(weeks[0]));
            if(!range) return;
            bomTopFilterState.Month.clear();
            bomTopFilterState.Month.add(String(Number(range.end.slice(5,7))));
            document.querySelectorAll('[data-filter-key="Month"]').forEach(bar=>bomFilterBarOptions(bar,'Month'));
            updateBomFilterButtons();
        }

        function resetBomTopFilters(){
            Object.values(bomTopFilterState).forEach(s=>s.clear()); Object.values(ganttFilterState).forEach(s=>s.clear());
            updateBomFilterButtons();
            document.querySelectorAll('.bom-multi').forEach(bar=>bomFilterBarOptions(bar,bar.dataset.filterKey));
            applyBomUnifiedFilters();
        }
        function setBomSingleFilter(key, value){
            if(!bomTopFilterState[key]) return;
            bomTopFilterState[key].clear();
            if(value !== undefined && value !== null && String(value) !== '') bomTopFilterState[key].add(String(value));
            updateBomFilterButtons();
            document.querySelectorAll(`[data-filter-key="${key}"]`).forEach(bar=>bomFilterBarOptions(bar,key));
            applyBomUnifiedFilters();
        }
        function taskPassesBomTopFilters(t){
            return Object.keys(bomTopFilterState).every(key=>{
                const selected=bomTopFilterState[key];
                if(!selected.size) return true;
                const vals=bomTaskValues(key,t).map(String);
                return vals.some(v=>selected.has(v));
            });
        }
        function syncCalendarToBomWeekFilter(){
            // Calendar & Workload has its own visual period, so the unified Week
            // filter must also move the calendar to the selected reporting week.
            // Previously the filter only filtered dailyTasks; renderWeeklyCalendar()
            // continued using currentCalendarAnchor, making the Calendar appear
            // unchanged when Week was selected.
            const weeks=[...bomTopFilterState.Week];
            if (weeks.length !== 1) return;

            let year = new Date().getFullYear();
            const years=[...bomTopFilterState.Year];
            if (years.length === 1 && /^\d{4}$/.test(String(years[0]))) {
                year=Number(years[0]);
            } else {
                // Prefer the year from a task belonging to the selected week.
                const selectedWeek=String(weeks[0]);
                const match=dailyTasks.find(t=>String(getTaskWeekNumber(t) || '')===selectedWeek);
                const d=match ? cleanDateStr(match.start || match.plan || match.actual || '') : '';
                if (d) year=Number(d.slice(0,4));
            }

            const range=getIsoWeekRange(year,Number(weeks[0]));
            if(!range) return;
            currentCalendarAnchor=new Date(range.start+'T00:00:00');
        }

        function applyBomUnifiedFilters(){
            // Recalculate Daily Tracking status before applying the top Status filter.
            // This keeps the filter values and the displayed rows in sync with Start / Plan / Actual / today.
            dailyTasks.forEach(t=>calculateTaskMetadata(t));
            const filtered=dailyTasks.filter(taskPassesBomTopFilters);
            window.bomFilteredTasks=filtered;
            updateDashboardCharts();
            renderDailyTrackingTable();
            renderMyTasksTable();
            syncCalendarToBomWeekFilter();
            renderWeeklyCalendar();
            renderProjectsTable();
            renderGanttChart();
            restoreAdvancedTableFilters();
        }

        function calcBomCostSaving(){
            return (projectsList||[]).reduce((sum,p)=>sum+calcProjectEffectiveSaving(p),0);
        }
        function calcBomOvertimeHours(){
            // Normalize legacy/current labels so all overtime registrations are included.
            const rows = Array.isArray(timeoffOtList) ? timeoffOtList : [];
            return rows.reduce((sum, x) => {
                if(isHiddenMember(x?.pic||x?.member||x?.name||'')) return sum;
                const type = String(x?.type ?? x?.request_type ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
                if (type !== 'overtime') return sum;
                const hours = Number.parseFloat(String(x?.hours ?? x?.total_hours ?? 0).replace(',', '.'));
                return sum + (Number.isFinite(hours) && hours > 0 ? hours : 0);
            }, 0);
        }
        function updateDashboardFinancialKpis(){
            const c=document.getElementById('dashCostSaving'), o=document.getElementById('dashOvertime');
            if(c)c.textContent='$'+calcBomCostSaving().toLocaleString(undefined,{maximumFractionDigits:2});
            if(o)o.textContent=calcBomOvertimeHours().toLocaleString(undefined,{maximumFractionDigits:2})+' h';
        }
        function getDashboardOrangeHeatmapStyle(pct){
            const n=Math.max(0,Number(pct)||0);
            if(n<=0) return 'background:#fffaf0;color:#a16207;';
            const stops=[[0,'#fff7ed'],[25,'#ffedd5'],[50,'#fed7aa'],[75,'#fdba74'],[100,'#f97316'],[120,'#c2410c']];
            let a=stops[0],b=stops[stops.length-1];
            for(let i=0;i<stops.length-1;i++){if(n>=stops[i][0]&&n<=stops[i+1][0]){a=stops[i];b=stops[i+1];break;}}
            const t=Math.max(0,Math.min(1,(n-a[0])/(b[0]-a[0])));
            const rgb=h=>{h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]};
            const ar=rgb(a[1]),br=rgb(b[1]),c=ar.map((v,i)=>Math.round(v+(br[i]-v)*t));
            const lum=(0.299*c[0]+0.587*c[1]+0.114*c[2])/255;
            return `background:rgb(${c.join(',')});color:${lum>0.60?'#7c2d12':'#ffffff'};transition:background .2s ease,color .2s ease;`;
        }

        function renderDashboardWorkloadSummary(filteredTasks){
            const head=document.getElementById('dashWorkloadSummaryHeader'), body=document.getElementById('dashWorkloadSummaryBody');
            if(!head||!body)return;
            // Exclude Anny from this specific Workload Analysis Summary table.
            // This does not remove Anny from Users, tasks, charts, or other reports.
            const isExcludedWorkloadMember=name=>isHiddenMember(name);
            const members=canonicalPersonList(users
                .filter(u=>u.status==='Active')
                .map(u=>u.name||u.username||'')
                .filter(name=>!isExcludedWorkloadMember(name))
            ).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
            const rows=[...new Set(filteredTasks.map(t=>String(t.category||'Unassigned').trim()||'Unassigned'))].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
            if(!members.length||!rows.length){head.innerHTML='<tr><th>Category</th></tr>';body.innerHTML='<tr><td class="py-4 text-center text-slate-400">No Workload data available</td></tr>';return;}
            const pr=getDashboardPeriodRange();
            const cap={}; members.forEach(m=>cap[m]=calculateMemberCapacityForPeriod(m,pr.start,pr.end));
            const workload={}; members.forEach(m=>workload[m]={});
            const overlapHours=t=>{
                const capTask=getCapacityTaskForDailyTask(t); const usage=Number(t.usageTime); const h=(Number.isFinite(usage)&&usage>0)?usage:Number(t.workload??capTask?.workload??0)||0; if(h<=0)return 0;
                const st=cleanDateStr(t.start||t.plan||t.actual), en=cleanDateStr(t.actual||t.plan||t.start);
                if(!st||!en)return h; if(en<pr.start||st>pr.end)return 0;
                const a=new Date(Math.max(new Date(st+'T00:00:00').getTime(),new Date(pr.start+'T00:00:00').getTime()));
                const b=new Date(Math.min(new Date(en+'T00:00:00').getTime(),new Date(pr.end+'T00:00:00').getTime()));
                const totalDays=Math.max(1,Math.round((new Date(en)-new Date(st))/86400000)+1), overlapDays=Math.max(0,Math.round((b-a)/86400000)+1);
                return h*(overlapDays/totalDays);
            };
            filteredTasks.forEach(t=>{
                const h=overlapHours(t),
                    row=String(t.category||'Unassigned').trim()||'Unassigned',
                    pics=bomTaskValues('Member',t)
                        .map(m=>String(m||'').trim())
                        .filter(Boolean)
                        .filter(m=>!isExcludedWorkloadMember(m)),
                    share=pics.length?1/pics.length:0;
                // Anny is completely excluded from this summary calculation.
                // If a task has Anny + other PICs, the remaining PICs share the full task workload.
                pics.forEach(m=>{
                    if(workload[m]) workload[m][row]=(workload[m][row]||0)+h*share;
                });
            });
            const cls=p=>p<=0?'text-slate-300':p<5?'bg-blue-50 text-blue-800':p<15?'bg-blue-100 text-blue-900 font-semibold':p<30?'bg-indigo-100 text-indigo-900 font-semibold':p<50?'bg-amber-100 text-amber-900 font-bold':p<70?'bg-yellow-200 text-yellow-900 font-bold':p<85?'bg-emerald-100 text-emerald-900 font-bold':p<=100?'bg-green-300 text-green-950 font-extrabold':'bg-red-200 text-red-900 font-extrabold';
            let h='<tr><th class="py-2.5 px-3 bg-orange-700 min-w-[180px]">Category</th>'+members.map(m=>`<th class="py-2.5 px-2 text-center bg-orange-600 text-white">${escapeHtml(m)}</th>`).join('')+'</tr>';
            h+='<tr><th class="py-2.5 px-3 bg-amber-700 text-white">Total</th>'+members.map(m=>{const hours=Object.values(workload[m]).reduce((a,b)=>a+b,0),pct=cap[m]>0?hours/cap[m]*100:0;return `<th class="py-2 px-2 text-center" style="${getDashboardOrangeHeatmapStyle(pct)}" title="${hours.toFixed(2)} h / ${cap[m].toFixed(2)} h capacity">${pct.toFixed(1)}%</th>`;}).join('')+'</tr>';
            head.innerHTML=h;
            body.innerHTML=rows.map(row=>`<tr><td class="py-2 px-3 font-semibold">${escapeHtml(row)}</td>${members.map(m=>{const hours=workload[m][row]||0,pct=cap[m]>0?hours/cap[m]*100:0;return `<td class="py-2 px-2 text-center" style="${getDashboardOrangeHeatmapStyle(pct)}" title="${hours.toFixed(2)} h / ${cap[m].toFixed(2)} h capacity">${pct>0?pct.toFixed(1)+'%':'-'}</td>`;}).join('')}</tr>`).join('');
        }

        function copyTableToClipboard(tableId){
            const table=document.getElementById(tableId); if(!table)return;
            const rows=[...table.querySelectorAll('tr')].map(r=>[...r.querySelectorAll('th,td')].map(c=>c.innerText.trim()).join('\t')).join('\n');
            navigator.clipboard.writeText(rows).then(()=>showAppNotification('Table copied to clipboard.')).catch(()=>showAppNotification('Copy failed.','Error'));
        }
        function exportStyledTable(tableId, filename='Export'){
            const table=document.getElementById(tableId); if(!table)return;
            const clone=table.cloneNode(true); clone.querySelectorAll('button,i').forEach(e=>e.remove());
            const wb=XLSX.utils.book_new(), ws=XLSX.utils.table_to_sheet(clone);
            const rows=[...table.querySelectorAll('tr')].filter(r=>!r.classList.contains('hidden') && !r.classList.contains('request-placeholder'));
            rows.forEach((row,ri)=>{
                [...row.querySelectorAll('th,td')].forEach((cell,ci)=>{
                    const addr=XLSX.utils.encode_cell({r:ri,c:ci}); const style={alignment:{vertical:'center'}};
                    const cs=getComputedStyle(cell);
                    if(cs.backgroundColor && cs.backgroundColor!=='rgba(0, 0, 0, 0)') style.fill={patternType:'solid',fgColor:{rgb:rgbToHex(cs.backgroundColor)||'FFFFFF'}};
                    if(cs.color) style.font={color:{rgb:rgbToHex(cs.color)||'000000'},bold:cs.fontWeight>500};
                    ws[addr].s=style;
                });
            });
            ws['!cols']=Array.from({length:Math.max(...rows.map(r=>r.children.length),1)},()=>({wch:18}));
            XLSX.utils.book_append_sheet(wb,ws,'Data'); XLSX.writeFile(wb,`${filename}.xlsx`);
        }
        function rgbToHex(c){const m=String(c).match(/\d+/g);return m&&m.length>=3?m.slice(0,3).map(x=>parseInt(x).toString(16).padStart(2,'0')).join('').toUpperCase():null;}
        function copyReport(){
            const report=document.getElementById('tab-dashboard'); if(!report)return;
            const clone=report.cloneNode(true);
            clone.querySelectorAll('button,canvas,.bom-page-filter').forEach(el=>el.remove());
            navigator.clipboard.writeText(clone.innerText.trim()).then(()=>showAppNotification('Report copied to clipboard.')).catch(()=>showAppNotification('Copy failed.','Error'));
        }

        async function exportReportPdf(){
            const report=document.getElementById('tab-dashboard');
            if(!report||!window.html2canvas||!window.jspdf){showAppNotification('PDF export library is not available.','Error');return;}
            const loader=document.getElementById('loadingOverlay'), loaderText=document.getElementById('loadingOverlayText');
            if(loaderText)loaderText.textContent='Exporting report...'; if(loader)loader.classList.remove('opacity-0','pointer-events-none');
            try{
                // Close open filter menus before export. The live Dashboard is NOT rearranged;
                // all export-only changes are applied inside html2canvas's cloned document.
                report.querySelectorAll('.bom-multi-menu').forEach(m=>m.classList.add('hidden'));
                const {jsPDF}=window.jspdf;
                const EXPORT_WIDTH=1600;

                const pdfHeader=document.createElement('div');
                pdfHeader.id='pdfExportHeader';
                pdfHeader.style.cssText='display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:10px 18px 12px;margin:0;background:#f8fafc;border-bottom:1px solid #cbd5e1;box-sizing:border-box;width:100%;';
                const now=new Date(),pad=n=>String(n).padStart(2,'0');
                const exportDate=`${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
                pdfHeader.innerHTML=`<div style="font-size:20px;font-weight:800;color:#0f172a;letter-spacing:.2px;">${escapeHtml(String(window.activeTeamView||'IE Team'))} Workload Report</div><div style="font-size:10px;font-weight:600;color:#475569;white-space:nowrap;">Exported: ${exportDate}</div>`;

                const originalHeader=report.querySelector('.report-page-header');
                if(originalHeader) originalHeader.style.display='none';
                report.insertBefore(pdfHeader,report.firstChild);

                const canvas=await html2canvas(report,{
                    scale:2,
                    useCORS:true,
                    backgroundColor:'#f8fafc',
                    logging:false,
                    width:EXPORT_WIDTH,
                    windowWidth:EXPORT_WIDTH,
                    windowHeight:Math.max(window.innerHeight,report.scrollHeight),
                    scrollX:0,
                    scrollY:0,
                    imageTimeout:0,
                    allowTaint:false,
                    onclone: async (doc)=>{
                        const cloneReport=doc.getElementById('tab-dashboard');
                        if(!cloneReport) return;

                        // Export-only base sizing. The actual app layout remains untouched.
                        cloneReport.style.width=EXPORT_WIDTH+'px';
                        cloneReport.style.minWidth=EXPORT_WIDTH+'px';
                        cloneReport.style.maxWidth=EXPORT_WIDTH+'px';
                        cloneReport.style.margin='0';
                        cloneReport.style.padding='0';

                        const cloneContent=doc.getElementById('contentArea');
                        if(cloneContent){
                            cloneContent.style.width=EXPORT_WIDTH+'px';
                            cloneContent.style.minWidth=EXPORT_WIDTH+'px';
                            cloneContent.style.maxWidth=EXPORT_WIDTH+'px';
                            cloneContent.style.padding='0';
                            cloneContent.style.overflow='visible';
                        }

                        // 1) Export must not show Export / Copy / Export Data / Reset action buttons.
                        cloneReport.querySelectorAll('button.bom-action-btn').forEach(btn=>{
                            const txt=String(btn.textContent||'').trim().toLowerCase();
                            const onclick=String(btn.getAttribute('onclick')||'').toLowerCase();
                            if(txt.includes('export') || txt.includes('copy') || onclick.includes('exportreportpdf') || onclick.includes('copytabletoclipboard') || onclick.includes('exportstyledtable')){
                                btn.style.display='none';
                            }
                        });

                        // 2) Do not show the literal "Filters" label, but keep the selected filter values.
                        cloneReport.querySelectorAll('[data-bom-filter-bar]').forEach(bar=>{
                            const label=[...bar.children].find(el=>String(el.textContent||'').trim().toLowerCase()==='filters');
                            if(label) label.style.display='none';
                        });

                        // 3) Task Status (%) doughnut is intentionally omitted from the PDF.
                        const statusCanvas=doc.getElementById('chartTaskStatus');
                        const statusCard=statusCanvas ? statusCanvas.closest('.bg-white') : null;
                        if(statusCard) statusCard.style.display='none';

                        // With the status card removed, the first chart uses the full row width.
                        const topCharts=cloneReport.querySelector(':scope > .grid.grid-cols-1.lg\\:grid-cols-3');
                        if(topCharts){
                            topCharts.style.display='block';
                            topCharts.style.width='100%';
                        }
                        const workloadCard=doc.getElementById('chartWorkloadMember')?.closest('.bg-white');
                        if(workloadCard){
                            workloadCard.style.width='100%';
                            workloadCard.style.minWidth='0';
                            workloadCard.style.maxWidth='100%';
                            workloadCard.style.overflow='hidden';
                        }

                        // 4) Export-only workload analysis layout:
                        //    Team Workload % + Team Workload Hours = SAME ROW.
                        //    Category Workload Distribution By Member = SEPARATE FULL-WIDTH ROW.
                        const analysis=cloneReport.querySelector('.dashboard-workload-analysis-row');
                        if(analysis){
                            analysis.style.display='block';
                            analysis.style.width='100%';
                            analysis.style.minWidth='0';
                        }
                        const side=analysis?.querySelector('.dashboard-workload-side');
                        const summary=analysis?.querySelector('.dashboard-workload-summary-card');
                        if(side){
                            side.style.display='grid';
                            side.style.gridTemplateColumns='minmax(0,1fr) minmax(0,1fr)';
                            side.style.gap='24px';
                            side.style.width='100%';
                            side.style.minWidth='0';
                            side.style.margin='0 0 24px 0';
                        }
                        if(summary){
                            summary.style.display='block';
                            summary.style.width='100%';
                            summary.style.maxWidth='100%';
                            summary.style.minWidth='0';
                            summary.style.margin='0 0 24px 0';
                        }
                        cloneReport.querySelectorAll('.dashboard-workload-side-card').forEach(card=>{
                            card.style.width='100%';
                            card.style.minWidth='0';
                            card.style.height='320px';
                            card.style.minHeight='320px';
                            card.style.overflow='hidden';
                        });
                        cloneReport.querySelectorAll('.dashboard-workload-mini-chart').forEach(w=>{
                            w.style.width='100%';
                            w.style.height='265px';
                            w.style.minWidth='0';
                            w.style.overflow='hidden';
                        });

                        // 5) All table values are centered. Long values may wrap rather than disappear.
                        cloneReport.querySelectorAll('table').forEach(table=>{
                            table.style.width='100%';
                            table.style.maxWidth='100%';
                            table.style.tableLayout='fixed';
                            table.querySelectorAll('th,td').forEach(cell=>{
                                cell.style.textAlign='center';
                                cell.style.verticalAlign='middle';
                                cell.style.whiteSpace='normal';
                                cell.style.wordBreak='break-word';
                                cell.style.overflow='visible';
                            });
                        });
                        const categoryTable=doc.getElementById('dashWorkloadSummaryTable');
                        if(categoryTable){
                            categoryTable.style.tableLayout='fixed';
                            categoryTable.style.width='100%';
                            const firstCells=categoryTable.querySelectorAll('tr > th:first-child, tr > td:first-child');
                            firstCells.forEach(cell=>{
                                cell.style.width='180px';
                                cell.style.minWidth='180px';
                                cell.style.maxWidth='180px';
                                cell.style.whiteSpace='normal';
                                cell.style.wordBreak='break-word';
                                cell.style.textAlign='center';
                            });
                        }

                        // Calendar table should also stay inside the PDF width.
                        cloneReport.querySelectorAll('.dashboard-workload-dashboard-calendar, #dashCalendarWorkloadScroll').forEach(el=>{
                            el.style.width='100%';
                            el.style.maxWidth='100%';
                            el.style.overflow='visible';
                        });
                        cloneReport.querySelectorAll('.dashboard-workload-dashboard-calendar table').forEach(t=>{
                            t.style.width='100%';
                            t.style.minWidth='0';
                            t.style.tableLayout='fixed';
                        });

                        // FINAL PDF EXPORT OVERRIDES — applied last to beat earlier export CSS.
                        const exportStyle=doc.createElement('style');
                        exportStyle.textContent=`
                            #tab-dashboard{width:1600px!important;min-width:1600px!important;max-width:1600px!important;margin:0!important;padding:0!important;overflow:visible!important;}
                            #contentArea{width:1600px!important;min-width:1600px!important;max-width:1600px!important;padding:0!important;margin:0!important;overflow:visible!important;}
                            #tab-dashboard .bom-page-filter{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr)) 92px!important;align-items:center!important;gap:10px!important;width:100%!important;height:58px!important;min-height:58px!important;padding:8px 10px!important;overflow:visible!important;box-sizing:border-box!important;}
                            #tab-dashboard .bom-page-filter .text-\\[10px\\]{display:none!important;}
                            #tab-dashboard .bom-page-filter .bom-multi{min-width:0!important;width:100%!important;}
                            #tab-dashboard .bom-page-filter .bom-multi-btn{height:38px!important;min-height:38px!important;width:100%!important;padding:8px 10px!important;font-size:10px!important;line-height:20px!important;white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important;}
                            #tab-dashboard .bom-page-filter > .ml-auto{display:contents!important;}
                            #tab-dashboard .bom-page-filter > .ml-auto > button{grid-column:7!important;width:92px!important;height:38px!important;}
                            #tab-dashboard > .grid.grid-cols-2.md\\:grid-cols-4.xl\\:grid-cols-7{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;gap:14px!important;width:100%!important;}
                            #tab-dashboard > .grid.grid-cols-1.lg\\:grid-cols-3{display:block!important;width:100%!important;}
                            #tab-dashboard > .grid.grid-cols-1.lg\\:grid-cols-3 > div{width:100%!important;max-width:none!important;min-width:0!important;}
                            #tab-dashboard #chartWorkloadMember{width:100%!important;max-width:100%!important;}
                            #tab-dashboard .h-72{height:330px!important;}
                            #tab-dashboard .dashboard-workload-analysis-row{display:block!important;width:100%!important;height:auto!important;min-height:0!important;margin:0!important;padding:0!important;}
                            #tab-dashboard .dashboard-workload-side{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:16px!important;width:100%!important;height:auto!important;min-height:0!important;margin:0 0 16px 0!important;padding:0!important;}
                            #tab-dashboard .dashboard-workload-side-card{width:100%!important;height:380px!important;min-height:380px!important;max-height:380px!important;min-width:0!important;margin:0!important;overflow:hidden!important;}
                            #tab-dashboard .dashboard-workload-mini-chart{height:320px!important;min-height:320px!important;max-height:320px!important;width:100%!important;overflow:hidden!important;}
                            #tab-dashboard .dashboard-workload-summary-card{display:block!important;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;margin:0 0 16px 0!important;padding:16px!important;overflow:visible!important;}
                            #tab-dashboard .dashboard-workload-summary-card > div.flex-1{display:block!important;height:auto!important;min-height:0!important;overflow:visible!important;}
                            #tab-dashboard #dashWorkloadSummaryTable{width:100%!important;max-width:100%!important;min-width:0!important;table-layout:fixed!important;}
                            #tab-dashboard #dashWorkloadSummaryTable th,#tab-dashboard #dashWorkloadSummaryTable td{padding:5px 4px!important;line-height:1.15!important;text-align:center!important;vertical-align:middle!important;white-space:normal!important;word-break:break-word!important;overflow:visible!important;}
                            #tab-dashboard #dashWorkloadSummaryTable th:first-child,#tab-dashboard #dashWorkloadSummaryTable td:first-child{width:220px!important;min-width:220px!important;max-width:220px!important;}
                            #tab-dashboard table th,#tab-dashboard table td{text-align:center!important;vertical-align:middle!important;}
                            #tab-dashboard .dashboard-workload-dashboard-calendar{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;margin-top:0!important;}
                            #tab-dashboard .dashboard-workload-dashboard-calendar table{width:100%!important;min-width:0!important;table-layout:fixed!important;}
                            #tab-dashboard canvas{max-width:100%!important;box-sizing:border-box!important;}
                            /* FINAL: taller paired workload charts + tight gap before category table + small A4 margins */
                            #tab-dashboard .dashboard-workload-analysis-row{display:block!important;margin:0!important;padding:0!important;min-height:0!important;height:auto!important;}
                            #tab-dashboard .dashboard-workload-side{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:16px!important;width:100%!important;height:380px!important;min-height:380px!important;margin:0 0 16px 0!important;padding:0!important;}
                            #tab-dashboard .dashboard-workload-side-card{height:380px!important;min-height:380px!important;max-height:380px!important;margin:0!important;}
                            #tab-dashboard .dashboard-workload-mini-chart{height:320px!important;min-height:320px!important;max-height:320px!important;width:100%!important;}
                            #tab-dashboard .dashboard-workload-summary-card{margin:0!important;width:100%!important;min-height:0!important;height:auto!important;}
                            #tab-dashboard .dashboard-workload-summary-card > div.flex-1{min-height:0!important;height:auto!important;}
                        `;
                        doc.head.appendChild(exportStyle);

                        // 6) KPI cards remain on one row in the PDF.
                        const kpi=cloneReport.querySelector(':scope > .grid.grid-cols-2.md\\:grid-cols-4.xl\\:grid-cols-7');
                        if(kpi){
                            kpi.style.display='grid';
                            kpi.style.gridTemplateColumns='repeat(7,minmax(0,1fr))';
                            kpi.style.gap='16px';
                            kpi.style.width='100%';
                            kpi.querySelectorAll(':scope > *').forEach(card=>{
                                card.style.minWidth='0';
                                card.style.width='100%';
                            });
                        }

                        // Force chart canvases to fit their final export boxes.
                        cloneReport.querySelectorAll('canvas').forEach(c=>{
                            c.style.display='block';
                            c.style.width='100%';
                            c.style.maxWidth='100%';
                            c.style.height='100%';
                        });
                    }
                });

                const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
                const pageWidth=pdf.internal.pageSize.getWidth(),pageHeight=pdf.internal.pageSize.getHeight();
                const margin=4,usableWidth=pageWidth-2*margin,usableHeight=pageHeight-2*margin;
                const sourceWidth=canvas.width;
                const sourcePageHeight=Math.max(1,Math.floor(sourceWidth*(usableHeight/usableWidth)));
                let y=0,page=0;
                while(y<canvas.height){
                    const h=Math.min(sourcePageHeight,canvas.height-y);
                    const pc=document.createElement('canvas');
                    pc.width=sourceWidth; pc.height=h;
                    const ctx=pc.getContext('2d');
                    ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,sourceWidth,h);
                    ctx.drawImage(canvas,0,y,sourceWidth,h,0,0,sourceWidth,h);
                    if(page>0) pdf.addPage('a4','portrait');
                    const ph=usableWidth*(h/sourceWidth);
                    pdf.addImage(pc.toDataURL('image/jpeg',0.92),'JPEG',margin,margin,usableWidth,ph,undefined,'FAST');
                    y+=h; page++;
                }
                pdf.save(`Dashboard_Report_${new Date().toISOString().slice(0,10)}.pdf`);
                showAppNotification(`Dashboard report exported as A4 portrait (${page} page${page>1?'s':''}).`);
            }catch(err){
                console.error('PDF export error:',err);
                showAppNotification('Could not export report to PDF.','Error');
            }finally{
                const pdfHeader=document.getElementById('pdfExportHeader'); if(pdfHeader)pdfHeader.remove();
                const originalHeader=report.querySelector('.report-page-header'); if(originalHeader)originalHeader.style.display='';
                if(loader)loader.classList.add('opacity-0','pointer-events-none');
            }
        }
        function exportCurrentPageData(tabId){
            const root=document.getElementById(tabId); if(!root)return;
            const tables=[...root.querySelectorAll('table[id]')];
            if(!tables.length){ showAppNotification('No table data available on this page.'); return; }

            const wb=XLSX.utils.book_new();
            const borderStyle = {
                top:{style:'thin', color:{rgb:'D1D5DB'}},
                bottom:{style:'thin', color:{rgb:'D1D5DB'}},
                left:{style:'thin', color:{rgb:'D1D5DB'}},
                right:{style:'thin', color:{rgb:'D1D5DB'}}
            };

            tables.forEach((table,i)=>{
                const clone=table.cloneNode(true);
                clone.querySelectorAll('button,i').forEach(e=>e.remove());
                if(tabId==='tab-projects' && table.id==='table-projects'){
                    const headRow=clone.querySelector('thead tr');
                    const timeTh=[...headRow.children].findIndex(th=>th.innerText.trim().toLowerCase()==='timeline');
                    if(timeTh>=0){
                        const th=headRow.children[timeTh]; th.textContent='Start';
                        const planTh=document.createElement('th'); planTh.className=th.className; planTh.textContent='Plan'; th.parentNode.insertBefore(planTh,th.nextSibling);
                        clone.querySelectorAll('tbody tr').forEach(tr=>{
                            const td=tr.children[timeTh], text=(td?.innerText||'').split(/\s+-\s+/);
                            const start=document.createElement('td'); start.className=td?.className||''; start.textContent=(text[0]||'-').trim();
                            const plan=document.createElement('td'); plan.className=td?.className||''; plan.textContent=(text[1]||'-').trim();
                            td?.replaceWith(start); start.parentNode.insertBefore(plan,start.nextSibling);
                        });
                    }
                }
                // Export only rows currently visible after the Excel-style column filter.
                clone.querySelectorAll('tbody tr.hidden').forEach(e=>e.remove());
                // Excel export should use the visible/current value of form controls, not every <option>.
                clone.querySelectorAll('select').forEach(sel=>{
                    const value=sel.options?.[sel.selectedIndex]?.textContent ?? sel.value ?? '';
                    sel.replaceWith(document.createTextNode(String(value).trim()));
                });
                clone.querySelectorAll('input,textarea').forEach(ctrl=>{
                    ctrl.replaceWith(document.createTextNode(String(ctrl.value ?? '').trim()));
                });
                const ws=XLSX.utils.table_to_sheet(clone, {raw:true});
                const rows=[...table.querySelectorAll('tr')].filter(r=>!r.classList.contains('hidden'));
                const rowCount=rows.length;
                const maxCols=Math.max(1,...rows.map(r=>r.children.length));

                // Non-report exports intentionally use simple Excel formatting:
                // borders on every cell, filled header row, and data-driven column widths.
                for(let ri=0; ri<rowCount; ri++){
                    const row=rows[ri];
                    [...row.querySelectorAll('th,td')].forEach((cell,ci)=>{
                        const addr=XLSX.utils.encode_cell({r:ri,c:ci});
                        if(!ws[addr]) return;
                        const isHeader=ri===0 || cell.tagName==='TH';
                        ws[addr].s={
                            border:borderStyle,
                            alignment:{vertical:'center', wrapText:false},
                            fill:isHeader ? {patternType:'solid',fgColor:{rgb:'E2E8F0'}} : undefined,
                            font:isHeader ? {bold:true,color:{rgb:'0F172A'}} : undefined
                        };
                    });
                }

                const widths=[];
                for(let ci=0; ci<maxCols; ci++){
                    let maxLen=10;
                    rows.forEach(row=>{
                        const cell=row.children[ci];
                        if(cell){
                            const txt=(cell.innerText||'').trim().replace(/\s+/g,' ');
                            maxLen=Math.max(maxLen, txt.length);
                        }
                    });
                    widths.push({wch:Math.min(Math.max(maxLen+2,12),50)});
                }
                ws['!cols']=widths;

                let name=(table.getAttribute('data-export-name')||table.id||`Table_${i+1}`).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,31);
                XLSX.utils.book_append_sheet(wb,ws,name||`Table_${i+1}`);
            });
            XLSX.writeFile(wb,`${tabId.replace('tab-','')}_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
        }
        document.addEventListener('click',e=>{if(!e.target.closest('.bom-multi'))document.querySelectorAll('.bom-multi-menu').forEach(m=>m.classList.add('hidden'));});
        document.addEventListener('click',e=>{ if(!e.target.closest('#taskCategorySearch') && !e.target.closest('#taskCategoryLookup') && !e.target.closest('#taskNameSearch') && !e.target.closest('#taskNameLookup') && !e.target.closest('#taskCategoryLookup') && !e.target.closest('#taskNameLookup')) closeTaskLookups(); });
        function exportCapacityData() {
            if (capacityData.length === 0) { showAppNotification("No data to export."); return; }
            const worksheet = XLSX.utils.json_to_sheet(capacityData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Capacity");
            XLSX.writeFile(workbook, "Capacity_Setup.xlsx");
        }

        function renderTaskLookup(kind){
            const isCat=kind==='category';
            const input=document.getElementById(isCat?'taskCategorySearch':'taskNameSearch');
            const box=document.getElementById(isCat?'taskCategoryLookup':'taskNameLookup');
            if(!input||!box)return;
            const q=String(input.value||'').trim().toLowerCase();
            const cat=String(document.getElementById('taskCategory')?.value||'').trim();
            const values=isCat
                ? [...new Set(capacityData.map(c=>String(c.category||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
                : [...new Set(capacityData.filter(c=>String(c.category||'').trim()===cat).map(c=>String(c.task||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
            const filtered=values.filter(v=>v.toLowerCase().includes(q));
            box.innerHTML='';
            if(!filtered.length){
                box.innerHTML='<div class="px-3 py-2 text-[11px] text-slate-400">No matching item</div>';
            }else{
                filtered.forEach(v=>{
                    const btn=document.createElement('button');
                    btn.type='button';
                    btn.className='block w-full text-left px-3 py-2 text-[11px] hover:bg-indigo-50';
                    btn.textContent=v;
                    btn.addEventListener('mousedown',e=>e.preventDefault());
                    btn.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); selectTaskLookup(kind,v); });
                    box.appendChild(btn);
                });
            }
            box.classList.remove('hidden');
            box.style.display='block';
        }
        function openTaskLookup(kind){ renderTaskLookup(kind); }
        function toggleTaskLookup(kind){
            const box=document.getElementById(kind==='category'?'taskCategoryLookup':'taskNameLookup');
            if(!box)return;
            if(box.classList.contains('hidden') || box.style.display==='none') renderTaskLookup(kind);
            else { box.classList.add('hidden'); box.style.display='none'; }
        }
        function closeTaskLookups(){
            ['taskCategoryLookup','taskNameLookup'].forEach(id=>{
                const box=document.getElementById(id);
                if(box){ box.classList.add('hidden'); box.style.display='none'; }
            });
        }
        function selectTaskLookup(kind,value){
            const selectedValue=String(value ?? '').trim();
            if(!selectedValue)return;
            if(kind==='category'){
                const search=document.getElementById('taskCategorySearch');
                const select=document.getElementById('taskCategory');
                if(!search||!select)return;
                let opt=[...select.options].find(o=>normalizeWorkloadKey(o.value)===normalizeWorkloadKey(selectedValue));
                if(!opt){ opt=document.createElement('option'); opt.value=selectedValue; opt.textContent=selectedValue; select.appendChild(opt); }
                select.value=opt.value;
                search.value=selectedValue;
                onTaskCategoryChange();
                search.value=selectedValue;
            }else{
                const search=document.getElementById('taskNameSearch');
                const select=document.getElementById('taskNameSelect');
                const cat=document.getElementById('taskCategory')?.value||'';
                if(!search||!select)return;
                let opt=[...select.options].find(o=>normalizeWorkloadKey(o.value)===normalizeWorkloadKey(selectedValue));
                if(!opt){ opt=document.createElement('option'); opt.value=selectedValue; opt.textContent=selectedValue; select.appendChild(opt); }
                select.value=opt.value;
                search.value=selectedValue;
                onTaskNameChange();
                search.value=selectedValue;
                // Usage Time is intentionally left blank on Create Task.
            }
            closeTaskLookups();
            document.activeElement?.blur?.();
        }

        function onTaskCategorySearch() {
            renderTaskLookup('category');
            const input = document.getElementById('taskCategorySearch');
            const select = document.getElementById('taskCategory');
            const typed = String(input?.value || '').trim();
            const matched = Array.from(select?.options || []).find(o => String(o.value).trim().toLowerCase() === typed.toLowerCase());
            if (matched) {
                select.value = matched.value;
                onTaskCategoryChange();
            } else {
                select.value = '';
                const taskNameSearch = document.getElementById('taskNameSearch');
                if (taskNameSearch) taskNameSearch.value = '';
                const taskNameSelect = document.getElementById('taskNameSelect');
                if (taskNameSelect) taskNameSelect.innerHTML = '<option value="">-- Select Category First --</option>';
                document.getElementById('taskUsageTime').value = '';
            }
        }

        function onTaskCategoryChange() {
            taskScopeUserChanged = false;
            const cat = document.getElementById('taskCategory').value;
            updateTaskScopeField();
            const taskNameSelect = document.getElementById('taskNameSelect');
            const taskNameSearch = document.getElementById('taskNameSearch');
            const taskNameOptions = document.getElementById('taskNameOptions');
            const taskNameOther = document.getElementById('taskNameOther');
            const tasksInCat = capacityData.filter(c => String(c.category || '').trim() === cat);
            taskNameOther.classList.add('hidden');
            taskNameOther.required = false;
            taskNameSelect.required = false;
            taskNameSelect.innerHTML = '<option value="">-- Select Task Name --</option>' + tasksInCat.map(t => `<option value="${escapeHtml(t.task)}">${escapeHtml(t.task)}</option>`).join('');
            if (String(cat).trim().toLowerCase() === 'other') {
                taskNameSelect.innerHTML += '<option value="__OTHER_NEW__">+ Add New Task Name</option>';
            }
            if (taskNameOptions) {
                taskNameOptions.innerHTML = tasksInCat.map(t => `<option value="${escapeHtml(t.task)}"></option>`).join('');
            }
            if (taskNameSearch) { taskNameSearch.value = ''; taskNameSearch.required = true; }
            document.getElementById('taskUsageTime').value = '';
            updateTaskScopeSuggestion(false);
        }

        function onTaskNameSearch() {
            renderTaskLookup('task');
            const input = document.getElementById('taskNameSearch');
            const select = document.getElementById('taskNameSelect');
            const typed = String(input?.value || '').trim();
            const matched = Array.from(select?.options || []).find(o => String(o.value).trim().toLowerCase() === typed.toLowerCase());
            if (matched) {
                select.value = matched.value;
                onTaskNameChange();
            } else {
                select.value = '';
                document.getElementById('taskUsageTime').value = '';
            }
        }

        function onTaskNameChange() {
            taskScopeUserChanged = false;
            const cat = document.getElementById('taskCategory').value;
            const taskNameSelect = document.getElementById('taskNameSelect');
            const taskNameSearch = document.getElementById('taskNameSearch');
            const taskNameOther = document.getElementById('taskNameOther');
            const selected = taskNameSelect.value;
            if (selected === '__OTHER_NEW__') {
                if (taskNameSearch) taskNameSearch.required = false;
                taskNameOther.classList.remove('hidden');
                taskNameOther.required = true;
                taskNameOther.focus();
                if (taskNameSearch) taskNameSearch.value = '';
                document.getElementById('taskUsageTime').value = '';
                updateTaskScopeSuggestion(false);
                return;
            }
            taskNameOther.classList.add('hidden');
            taskNameOther.required = false;
            if (taskNameSearch) { taskNameSearch.required = true; taskNameSearch.value = selected; }
            // Do not suggest/copy Workload (Hour) into Create Task.
            document.getElementById('taskUsageTime').value = '';
            updateTaskScopeSuggestion(false);
        }

        function getSelectedTaskName() {
            const select = document.getElementById('taskNameSelect');
            if (select.value === '__OTHER_NEW__') return document.getElementById('taskNameOther').value.trim();
            return (document.getElementById('taskNameSearch')?.value || select.value || '').trim();
        }
        // Scope from Category Setup is only a suggestion. Once the user manually
        // chooses a Scope, category/task changes must not overwrite that choice.
        let taskScopeUserChanged = false;
        function onTaskScopeUserChange(){
            taskScopeUserChanged = true;
            const field=document.getElementById('taskScope');
            const options=document.getElementById('taskScopeOptions');
            const value=String(field?.value||'').trim();
            if(value && options && !Array.from(options.options).some(o=>String(o.value).trim()===value)) options.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}"></option>`);
        }
        function updateTaskScopeSuggestion(preserveExplicit=false){
            const wrap=document.getElementById('taskScopeWrap'), select=document.getElementById('taskScope');
            if(!wrap||!select)return;
            const category=String(document.getElementById('taskCategory')?.value||'').trim();
            const taskName=getSelectedTaskName();
            const teamRows=(Array.isArray(capacityData)?capacityData:[]).filter(c=>teamMatch(c,{}));
            const scopeOptions=document.getElementById('taskScopeOptions');
            if(scopeOptions){
                const known=[...CAPACITY_SCOPES,...teamRows.map(c=>String(c.scope||'').trim())];
                const current=String(select.value||'').trim();
                if(current) known.push(current);
                scopeOptions.innerHTML=[...new Set(known.filter(Boolean))].map(v=>`<option value="${escapeHtml(v)}"></option>`).join('');
            }
            wrap.classList.remove('hidden');
            const otherTask=normalizeWorkloadKey(taskName)==='other task';
            select.required=!otherTask;
            document.getElementById('taskScopeRequiredMark')?.classList.toggle('hidden',otherTask);
            document.getElementById('taskScopeOptionalMark')?.classList.toggle('hidden',!otherTask);
            // Exact Task Name "Other task" intentionally has no Scope, regardless of Category.
            if(otherTask){ select.value=''; taskScopeUserChanged=false; return; }
            // Edit mode keeps the saved Scope; a manual Scope choice is kept until
            // Category or Task Name is changed again.
            if(preserveExplicit && String(select.value||'').trim()) return;
            if(taskScopeUserChanged) return;
            const ck=normalizeWorkloadKey(category), tk=normalizeWorkloadKey(taskName);
            const inCat=teamRows.filter(c=>normalizeWorkloadKey(c.category)===ck);
            let suggested='';
            const match=tk ? inCat.find(c=>normalizeWorkloadKey(c.task)===tk) : null;
            if(match) suggested=String(match.scope||'').trim();
            else {
                // No Task Name yet: if every task of this Category has the same Scope, use it.
                const scopes=[...new Set(inCat.map(c=>String(c.scope||'').trim()).filter(Boolean))];
                if(scopes.length===1) suggested=scopes[0];
            }
            select.value=suggested;
        }
        function updateTaskScopeField(){ updateTaskScopeSuggestion(false); }

        function normalizeTaskPriority(value){
            if(value===null||value===undefined||String(value).trim()==='') return '';
            const s=String(value).trim().toLowerCase();
            if(['low','medium','high'].includes(s)) return s.charAt(0).toUpperCase()+s.slice(1);
            const n=Number(s.replace(',','.'));
            if(!Number.isFinite(n)) return String(value).trim();
            if(n<=2) return 'Low'; if(n===3) return 'Medium'; return 'High';
        }

        function calculateTaskMetadata(task) {
            const today = formatDateLocal(new Date());
            const start = cleanDateStr(task.start);
            const plan = cleanDateStr(task.plan);
            const actual = cleanDateStr(task.actual);
            if (actual) {
                task.status = 'Completed';
                task.discipline = plan && actual <= plan ? 'On Time' : 'Overdue';
            } else if (start && today < start) {
                task.status = 'Not Started';
                task.discipline = 'On Track';
            } else if (plan && today > plan) {
                task.status = 'Overdue';
                task.discipline = 'Overdue';
            } else {
                task.status = 'Working';
                task.discipline = 'On Track';
            }
            return task;
        }

        // Category Setup > Workload (Hour) is a calculated reference value.
        // It stores the arithmetic average of Usage Time entered in Daily Tracking
        // for the same Category + Task Name. It is never manually edited.
        function recalculateCapacityWorkloadsFromTasks(){
            const buckets=new Map();
            dailyTasks.forEach(t=>{
                const category=String(t?.category||'').trim();
                const task=String(t?.name||'').trim();
                const hours=Number(t?.usageTime);
                if(!category||!task||!Number.isFinite(hours)||hours<=0)return;
                const key=`${teamKeyOf(t)}###${normalizeWorkloadKey(category)}|||${normalizeWorkloadKey(task)}`;
                const b=buckets.get(key)||{sum:0,count:0};
                b.sum+=hours; b.count+=1; buckets.set(key,b);
            });
            capacityData.forEach(c=>{
                const key=`${teamKeyOf(c)}###${normalizeWorkloadKey(c?.category)}|||${normalizeWorkloadKey(c?.task)}`;
                const b=buckets.get(key);
                c.workload=b ? +(b.sum/b.count).toFixed(2) : 0;
            });
            return capacityData;
        }

        async function syncCapacityWorkloadsFromTasks(){
            recalculateCapacityWorkloadsFromTasks();
            await saveSheetData('Capacity',capacityData);
            renderCapacityTable();
        }

        function taskPICs(task) {
            return canonicalPersonList((task?.pics && task.pics.length) ? task.pics : task?.pic);
        }
        function normalizeTaskPersonName(v){
            return String(v ?? '').replace(/\s+/g,' ').trim().toLowerCase();
        }
        function canEditTask(task) {
            if (!task || !currentUser) return false;
            const me = normalizeTaskPersonName(currentUser.name || currentUser.displayName || currentUser.username);
            const role = normalizeTaskPersonName(currentUser.role);
            // Admin is allowed to edit/delete every task.
            if (role === 'admin' || role === 'administrator') return true;
            const pics = taskPICs(task).map(normalizeTaskPersonName).filter(Boolean);
            const creator = normalizeTaskPersonName(task.createdBy || task.created_by);
            return !!me && (pics.includes(me) || creator === me);
        }
        function assertCanEditTask(task) {
            if (canEditTask(task)) return true;
            showAppNotification('You can only edit or delete tasks where PIC is you. Admin can edit all tasks.', 'Permission denied');
            return false;
        }

        const expandedTaskRows = new Set();
        const advancedTableFilters = {};
        function creationTimeValue(row){
            const raw=row?.createdAt || row?.created_at || row?.savedAt || row?.saved_at || '';
            const t=Date.parse(raw);
            if(Number.isFinite(t)) return t;
            const id=Number(row?.id);
            return Number.isFinite(id) ? id : 0;
        }
        function compareByCreationTimeDesc(a,b){
            return creationTimeValue(b)-creationTimeValue(a) || String(b?.id??'').localeCompare(String(a?.id??''),undefined,{numeric:true});
        }

        function applyExpandedRowState(row, rowId) {
            if (!row) return;
            const expanded = expandedTaskRows.has(String(rowId));
            row.classList.toggle('task-row-expanded', expanded);
            const itemCell = row.querySelector('.task-items-cell');
            const itemText = row.querySelector('.task-items-text');
            if (itemCell) {
                itemCell.classList.toggle('max-w-[200px]', !expanded);
                itemCell.classList.toggle('whitespace-nowrap', !expanded);
                itemCell.classList.toggle('whitespace-normal', expanded);
                itemCell.classList.toggle('align-top', expanded);
            }
            if (itemText) {
                itemText.classList.toggle('truncate', !expanded);
                itemText.classList.toggle('whitespace-normal', expanded);
                itemText.classList.toggle('break-words', expanded);
            }
        }
        function toggleRowExpand(rowId) {
            const key=String(rowId);
            if(expandedTaskRows.has(key)) expandedTaskRows.delete(key); else expandedTaskRows.add(key);
            applyExpandedRowState(document.getElementById(`task-row-${rowId}`), rowId);
        }
        function restoreAdvancedTableFilters() {
            Object.keys(advancedTableFilters).forEach(tableId=>recomputeAdvancedTableFilter(tableId));
            decorateAdvancedFilterControls();
        }

        function bindTaskActionHandlers() {
            const bind = (tbody) => {
                if (!tbody) return;
                tbody.onclick = async (event) => {
                    const button = event.target.closest?.('[data-task-action]');
                    if (!button || !tbody.contains(button)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const id = button.getAttribute('data-task-id');
                    const action = button.getAttribute('data-task-action');
                    if (!id) return;
                    try {
                        if (action === 'edit') editDailyTask(id);
                        else if (action === 'delete') await deleteDailyTask(id);
                    } catch (err) {
                        console.error('Task action error:', err);
                        showAppNotification(`Task action failed. ${err?.message || err || 'Unknown error'}`, 'Task Error');
                    }
                };
            };
            bind(document.getElementById('dailyTrackingTableBody'));
            bind(document.getElementById('myTasksTableBody'));
        }

        function renderDailyTrackingTable() {
            const tbody = document.getElementById('dailyTrackingTableBody');
            tbody.innerHTML = '';
            const filtered = (window.bomFilteredTasks || dailyTasks).filter(taskPassesBomTopFilters).slice().sort(compareByCreationTimeDesc);

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="13" class="py-6 text-center text-slate-400 italic">No tasks logged.</td></tr>`;
                return;
            }

            filtered.forEach(task => {
                calculateTaskMetadata(task);
                const tr = document.createElement('tr');
                tr.id = `task-row-${task.id}`;
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100 font-medium cursor-pointer";
                tr.setAttribute('onclick', `toggleRowExpand(${JSON.stringify(String(task.id))})`);

                let priorityBadge = task.priority === 'High' ? 'bg-red-100 text-red-700' : (task.priority === 'Medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700');
                let statusBadge = task.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : (task.status === 'Overdue' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800');
                let disciplineBadge = task.discipline === 'On Time' ? 'text-emerald-600 font-bold' : (task.discipline === 'Overdue' ? 'text-red-600 font-bold' : 'text-slate-400');
                const picsList = reportableTaskPICs(task).join(', ') || '-';
                const itemsText = escapeHtml(task.items || '-');

                tr.innerHTML = `
                    <td class="py-3 px-3 font-bold text-slate-800">${escapeHtml(task.category)}</td>
                    <td class="py-3 px-3 text-slate-800 font-semibold task-name-cell" title="${escapeHtml(task.name)}"><span class="task-name-text">${escapeHtml(task.name)}</span></td>
                    <td class="py-3 px-3 text-indigo-600 task-items-cell max-w-[200px] whitespace-nowrap align-top" title="Click row to expand">
                        <div class="task-items-text truncate">${itemsText}</div>
                    </td>
                    <td class="py-3 px-2 text-center task-scope-cell" title="${escapeHtml(task.scope || getDailyTaskScope(task) || '-')}">${escapeHtml(task.scope || getDailyTaskScope(task) || '-')}</td>
                    <td class="py-3 px-2 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${priorityBadge}">${escapeHtml(task.priority)}</span></td>
                    <td class="py-3 px-3">${escapeHtml(picsList)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.start)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.plan)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.actual)}</td>
                    <td class="py-3 px-2 text-center font-bold text-indigo-600">${task.usageTime}h</td>
                    <td class="py-3 px-3 ${disciplineBadge}">${task.discipline || '-'}</td>
                    <td class="py-3 px-2 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${statusBadge}">${task.status}</span></td>
                    <td class="py-3 px-2 text-center">
                        ${canEditTask(task) ? `<button type="button" data-task-action="edit" data-task-id="${escapeHtml(String(task.id))}" class="task-action-btn text-slate-400 hover:text-indigo-600 mr-2" title="Edit task"><i class="fa-solid fa-pen-to-square pointer-events-none"></i></button><button type="button" data-task-action="delete" data-task-id="${escapeHtml(String(task.id))}" class="task-action-btn text-slate-400 hover:text-red-600" title="Delete task"><i class="fa-solid fa-trash pointer-events-none"></i></button>` : `<span class="text-slate-300" title="Only PIC or Admin can edit"><i class="fa-solid fa-lock"></i></span>`}
                    </td>
                `;
                tbody.appendChild(tr);
                applyExpandedRowState(tr, task.id);
            });
            restoreAdvancedTableFilters();
        }

        function renderMyTasksTable() {
            const tbody = document.getElementById('myTasksTableBody');
            if(!tbody || !currentUser) return;
            tbody.innerHTML = '';
            const myTasksUserName = document.getElementById('myTasksUserName');
            const managementOnly=typeof isHiddenMember==='function'&&isHiddenMember(currentUser.name||currentUser.username||'');
            if (myTasksUserName) myTasksUserName.innerText = managementOnly?'Management-only access':currentUser.name;

            const myTasks = (managementOnly?[]:(window.bomFilteredTasks || dailyTasks)).filter(t => {
                const me=normalizePersonKey(currentUser?.name||currentUser?.username||'');
                return taskPICs(t).some(pic=>normalizePersonKey(pic)===me);
            }).slice().sort(compareByCreationTimeDesc);

            if (myTasks.length === 0) {
                tbody.innerHTML = `<tr><td colspan="12" class="py-6 text-center text-slate-400 italic">No tasks assigned to you.</td></tr>`;
                return;
            }

            myTasks.forEach(task => {
                calculateTaskMetadata(task);
                const rowKey = `my-${task.id}`;
                const tr = document.createElement('tr');
                tr.id = `task-row-${rowKey}`;
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100 font-medium cursor-pointer";
                tr.setAttribute('onclick', `toggleRowExpand('${rowKey}')`);

                let statusBadge = task.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' : (task.status === 'Overdue' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800');
                let disciplineBadge = task.discipline === 'On Time' ? 'text-emerald-600 font-bold' : (task.discipline === 'Overdue' ? 'text-red-600 font-bold' : 'text-slate-400');
                const itemsText = escapeHtml(task.items || '-');

                tr.innerHTML = `
                    <td class="py-3 px-3 font-bold text-slate-800">${escapeHtml(task.category)}</td>
                    <td class="py-3 px-3 text-slate-800 font-semibold task-name-cell" title="${escapeHtml(task.name)}"><span class="task-name-text">${escapeHtml(task.name)}</span></td>
                    <td class="py-3 px-3 text-indigo-600 task-items-cell max-w-[200px] whitespace-nowrap align-top" title="Click row to expand"><div class="task-items-text truncate">${itemsText}</div></td>
                    <td class="py-3 px-2 text-center task-scope-cell" title="${escapeHtml(task.scope || getDailyTaskScope(task) || '-')}">${escapeHtml(task.scope || getDailyTaskScope(task) || '-')}</td>
                    <td class="py-3 px-2 text-center">${escapeHtml(task.priority)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.start)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.plan)}</td>
                    <td class="py-3 px-2 text-center text-slate-500">${formatDateMMDDYYYY(task.actual)}</td>
                    <td class="py-3 px-2 text-center font-bold text-indigo-600">${task.usageTime}h</td>
                    <td class="py-3 px-3 ${disciplineBadge}">${task.discipline || '-'}</td>
                    <td class="py-3 px-2 text-center"><span class="px-2 py-0.5 rounded text-[11px] font-bold ${statusBadge}">${task.status}</span></td>
                    <td class="py-3 px-2 text-center">${canEditTask(task) ? `<button type="button" data-task-action="edit" data-task-id="${escapeHtml(String(task.id))}" class="task-action-btn text-slate-400 hover:text-indigo-600 mr-2" title="Edit task"><i class="fa-solid fa-pen-to-square pointer-events-none"></i></button><button type="button" data-task-action="delete" data-task-id="${escapeHtml(String(task.id))}" class="task-action-btn text-slate-400 hover:text-red-600" title="Delete task"><i class="fa-solid fa-trash pointer-events-none"></i></button>` : `<span class="text-slate-300"><i class="fa-solid fa-lock"></i></span>`}</td>
                `;
                tbody.appendChild(tr);
                applyExpandedRowState(tr, rowKey);
            });
            restoreAdvancedTableFilters();
        }

        bindTaskActionHandlers();

        function parseImportDate(value) {
            if (value === null || value === undefined || value === '') return '';
            if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
                const d = XLSX.SSF.parse_date_code(value);
                if (d && d.y && d.m && d.d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            }
            return cleanDateStr(value);
        }

        function normalizeImportHeader(value) {
            return String(value ?? '')
                .trim()
                .toLowerCase()
                .replace(/[\s_\-()]+/g, '')
                .replace(/[^a-z0-9]/g, '');
        }

        function handleTaskImport(e, target) {
            const file=e.target.files?.[0]; if(!file) return;
            const reader=new FileReader();
            reader.onload=async evt=>{
                try{
                    const wb=XLSX.read(new Uint8Array(evt.target.result),{type:'array',cellDates:false});
                    const firstSheet=wb.Sheets[wb.SheetNames[0]];
                    const rows=XLSX.utils.sheet_to_json(firstSheet,{defval:''});
                    if(!rows.length) throw new Error('Excel/CSV file has no data.');

                    const errors=[]; const imported=[];
                    const headerMap = row => {
                        const out={};
                        Object.keys(row).forEach(k=>out[normalizeImportHeader(k)]=row[k]);
                        return out;
                    };
                    const find=(r,...keys)=>{
                        const normalized=headerMap(r);
                        for(const k of keys){
                            const v=normalized[normalizeImportHeader(k)];
                            if(v!==undefined&&v!==null&&String(v).trim()!=='') return v;
                        }
                        return '';
                    };

                    rows.forEach((r,i)=>{
                        const category=String(find(r,'category','Category')).trim();
                        const name=String(find(r,'task name','Task Name','task','Task','name')).trim();
                        const items=String(find(r,'detail','Detail','items','Items','item')).trim();
                        const priority=normalizeTaskPriority(String(find(r,'priority','Priority')).trim()||'Medium');
                        const importedPics=canonicalPersonList(find(r,'pic','PIC','pics','Assigned PICs','Assigned PIC'));
                        const pic=importedPics.join(', ');
                        const start=parseImportDate(find(r,'start','Start','start date','Start Date'));
                        const plan=parseImportDate(find(r,'plan','Plan','plan date','Plan Date','due date','Due Date'));
                        const actual=parseImportDate(find(r,'actual','Actual','actual date','Actual Date'));
                        const usageRaw=find(r,'usageTime','UsageTime','usage time','Usage Time','total usage time','Total Usage Time','hours','Hour');
                        const importedScope=String(find(r,'scope','Scope')).trim();
                        const cap=capacityData.find(c=>String(c.category||'').trim().toLowerCase()===category.toLowerCase()&&String(c.task||'').trim().toLowerCase()===name.toLowerCase()&&teamMatch(c,{}));
                        const suggestedScope=String(cap?.scope||'').trim();
                        const scope=normalizeWorkloadKey(name)==='other task' ? '' : (importedScope || suggestedScope);
                        const usage=usageRaw==='' ? Number(cap?.workload) : Number(usageRaw);

                        if(!category||!name||!cap) errors.push(`Row ${i+2}: Category + Task Name not found in Capacity Setup.`);
                        if(!items) errors.push(`Row ${i+2}: Items is required.`);
                        if(!pic) errors.push(`Row ${i+2}: PIC is required.`);
                        if(!start||!plan||plan<start) errors.push(`Row ${i+2}: invalid Start/Plan.`);
                        if(actual&&actual<start) errors.push(`Row ${i+2}: Actual cannot be before Start.`);
                        if(!Number.isFinite(usage)||usage<=0) errors.push(`Row ${i+2}: invalid Usage Time (or no Capacity workload found).`);
                        if(!scope && normalizeWorkloadKey(name)!=='other task') errors.push(`Row ${i+2}: Scope is required unless Task Name is Other task.`);
                        if(!['High','Medium','Low'].includes(priority)) errors.push(`Row ${i+2}: Priority must be High, Medium or Low.`);
                        if(target==='my' && currentUser && !taskPICs({pic}).some(p=>p.toLowerCase()===currentUser.name.toLowerCase())) {
                            errors.push(`Row ${i+2}: My Tasks import must have PIC = ${currentUser.name}.`);
                        }

                        const pics=importedPics;
                        const task={
                            id:`${Date.now()}-${i}-${Math.random().toString(36).slice(2,8)}`,
                            category,name,items,scope,priority,pic,pics,start,plan,actual,
                            startDate:start,planDate:plan,actualDate:actual,usageTime:usage,
                            createdBy:currentUser?.name||'',savedAt:new Date().toISOString()
                        };
                        // Status and Discipline are intentionally NOT read from the file.
                        // They are always recalculated from Start / Plan / Actual / today's date.
                        imported.push(calculateTaskMetadata(task));
                    });

                    if(errors.length) throw new Error(errors.slice(0,12).join('\n')+(errors.length>12?`\n...and ${errors.length-12} more.`:''));
                    if(target==='my' && currentUser) imported.forEach(t=>{t.pic=currentUser.name;t.pics=[currentUser.name];calculateTaskMetadata(t);});

                    dailyTasks=[...imported,...dailyTasks];
                    await saveSheetData('Tasks',dailyTasks);
                    // Re-read the authoritative Supabase rows so newly inserted tasks use their
                    // database identity and are not left in the UI with temporary client IDs.
                    if(typeof fetchAllDataFromSheet==='function'){
                        const refreshed=await fetchAllDataFromSheet({background:false});
                        if(refreshed===false) throw new Error('Tasks were submitted but Supabase refresh failed. Please check the database connection and try again.');
                    }
                    await syncCapacityWorkloadsFromTasks();
                    applyGlobalFilters();
                    showAppNotification(`${imported.length} task(s) imported and synchronized. Status & Discipline were auto-calculated.`);
                }catch(err){showAppNotification(err.message,'Import Error');}
                finally{e.target.value='';}
            };
            reader.readAsArrayBuffer(file);
        }

        function openAddTaskModal() {
            document.getElementById('taskModalTitle').innerText = 'Create New Task';
            document.getElementById('taskId').value = '';
            document.getElementById('taskForm').reset();
            renderPICCheckboxLists();
            const checkboxes = document.querySelectorAll('.task-pic-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = currentUser && cb.value === currentUser.name;
            });
            document.getElementById('taskNameSelect').innerHTML = '<option value="">-- Select Category First --</option>';
            const taskCategorySearch = document.getElementById('taskCategorySearch');
            const taskNameSearch = document.getElementById('taskNameSearch');
            if (taskCategorySearch) taskCategorySearch.value = '';
            if (taskNameSearch) taskNameSearch.value = '';
            document.getElementById('taskNameOther').value = '';
            document.getElementById('taskNameOther').classList.add('hidden');
            document.getElementById('taskNameOther').required = false;
            const taskScope=document.getElementById('taskScope'); taskScopeUserChanged=false; if(taskScope) taskScope.value='';
            updateTaskScopeField();
            document.getElementById('taskModal').classList.remove('opacity-0', 'pointer-events-none');
            document.body.classList.add('modal-active');
        }
        function closeTaskModal() {
            document.getElementById('taskModal').classList.add('opacity-0', 'pointer-events-none');
            document.body.classList.remove('modal-active');
        }
        function onTaskStartChange(){
            const start=document.getElementById('taskStart')?.value||'';
            const plan=document.getElementById('taskPlan');
            const actual=document.getElementById('taskActual');
            if(!plan||!actual)return;
            plan.min=start||'';
            actual.min=start||'';
            if(start){
                // New/empty plan defaults to Start; if it was before Start, clamp it.
                if(!plan.value || plan.value<start) plan.value=start;
                if(actual.value && actual.value<start) actual.value='';
            }else{
                plan.min=''; actual.min='';
            }
        }
        function onTaskPlanChange(){
            const start=document.getElementById('taskStart')?.value||'';
            const plan=document.getElementById('taskPlan');
            if(start&&plan&&plan.value<start) plan.value=start;
        }
        function onTaskActualChange(){
            const start=document.getElementById('taskStart')?.value||'';
            const actual=document.getElementById('taskActual');
            if(start&&actual&&actual.value&&actual.value<start) actual.value='';
        }

        async function getSupabaseAuthContext(){
            try{
                const {data}=await supabaseClient.auth.getSession();
                return data?.session || null;
            }catch(_){ return null; }
        }

        async function findTaskRecordId(task){
            const id=Number(task?.id);
            return Number.isSafeInteger(id) && id>0 ? id : null;
        }

        async function saveTaskRecordDirect(task) {
            if(!initSupabaseClient()) throw (supabaseInitError || new Error('Supabase client is not available.'));
            const localId = task?.id;
            const recordId=await findTaskRecordId(task);
            task.team = getTaskWriteTeam(task);
            const payload=taskDbPayload(task);
            let result;
            if(recordId) {
                result=await supabaseClient.from(SUPABASE_TASK_TABLE).update(payload).eq('id',recordId).select('*').single();
            } else {
                result=await supabaseClient.from(SUPABASE_TASK_TABLE).insert(payload).select('*').single();
            }
            if(result.error) throw result.error;
            const mapped=mapDbTaskToApp(result.data);
            const idx=dailyTasks.findIndex(t=>String(t.id)===String(localId));
            if(idx>=0) dailyTasks[idx]=mapped;
            else dailyTasks.unshift(mapped);
            Object.assign(task,mapped);
            sheetSyncSnapshots.Tasks=JSON.parse(JSON.stringify(dailyTasks));
            lastLocalSaveAt.Tasks=Date.now();
            return true;
        }

        async function deleteTaskRecordDirect(task) {
            if(!initSupabaseClient()) throw (supabaseInitError || new Error('Supabase client is not available.'));
            const recordId=await findTaskRecordId(task);
            if(!recordId) throw new Error('Task ID is not a valid database ID.');
            const {data,error}=await teamGuard(supabaseClient.from(SUPABASE_TASK_TABLE).delete().eq('id',recordId)).select('id');
            if(error) throw error;
            if(!data?.length) throw new Error(`Supabase DELETE matched 0 rows for Tasks/${recordId}. Check RLS DELETE policy.`);
            sheetSyncSnapshots.Tasks=(sheetSyncSnapshots.Tasks||[]).filter(r=>String(r.id)!==String(recordId));
            lastLocalSaveAt.Tasks=Date.now(); return true;
        }

        // Power Automate notification webhook. Keep this URL private because it contains the flow signature.
        const POWER_AUTOMATE_WEBHOOK_URL = 'https://default5a9d9cfdc32e4ac1a9edfe83df4f9e.4d.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/9605697cb4c54cd6b099690c279f73c3/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ImpL5xjxrDm70NAWqZAkQrlAIIFIOaHwEvoSofcvZGc';

        function normalizeNotificationName(value) {
            return String(value || '').trim().toLowerCase();
        }

        async function sendPowerAutomateAssignmentNotification({ type, creator, assignees, planDate, recordId, item, priority }) {
            const creatorName = String(creator || '').trim();
            const creatorKey = normalizeNotificationName(creatorName);
            const allowedCreators = new Set(['anny', 'rita']);
            if (!allowedCreators.has(creatorKey)) return { sent: false, skipped: true, reason: 'creator-not-allowed' };

            const recipients = [...new Set((Array.isArray(assignees) ? assignees : [])
                .map(v => String(v || '').trim())
                .filter(Boolean)
                .filter(name => normalizeNotificationName(name) !== creatorKey))];
            if (!recipients.length) return { sent: false, skipped: true, reason: 'no-other-assignees' };

            const payload = {
                creator: creatorName,
                assignees: recipients,
                type: String(type || 'task').toLowerCase(),
                planDate: String(planDate || ''),
                recordId: recordId == null ? '' : String(recordId),
                item: String(item || ''),
                priority: String(priority || '')
            };

            const response = await fetch(POWER_AUTOMATE_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                mode: 'cors'
            });
            if (!response.ok) throw new Error(`Power Automate webhook returned HTTP ${response.status}.`);
            return { sent: true, payload };
        }

        async function saveDailyTask(e) {
            e.preventDefault();
            const id = document.getElementById('taskId').value;
            if (id) {
                const existing = dailyTasks.find(t=>String(t.id)===String(id));
                if (existing && !assertCanEditTask(existing)) return;
            }

            // Searchable dropdowns can display typed text while the hidden select is still empty.
            // Resolve exact matches before validating/saving so a valid new task is not rejected.
            const categorySelect = document.getElementById('taskCategory');
            const categorySearch = document.getElementById('taskCategorySearch');
            if (categorySelect && !categorySelect.value && categorySearch?.value.trim()) {
                const typedCategory = categorySearch.value.trim();
                const matchCategory = Array.from(categorySelect.options).find(o =>
                    String(o.value).trim().toLowerCase() === typedCategory.toLowerCase());
                if (matchCategory) { categorySelect.value = matchCategory.value; onTaskCategoryChange(); }
            }
            const taskSelect = document.getElementById('taskNameSelect');
            const taskSearch = document.getElementById('taskNameSearch');
            if (taskSelect && !taskSelect.value && taskSearch?.value.trim()) {
                const typedTask = taskSearch.value.trim();
                const matchTask = Array.from(taskSelect.options).find(o =>
                    String(o.value).trim().toLowerCase() === typedTask.toLowerCase());
                if (matchTask) { taskSelect.value = matchTask.value; onTaskNameChange(); }
            }
            updateTaskScopeSuggestion(true);
            const picsCheckboxes = document.querySelectorAll('.task-pic-checkbox');
            const selectedPics = Array.from(picsCheckboxes).filter(cb => cb.checked).map(cb => cb.value);
            const category = String(categorySelect?.value || categorySearch?.value || '').trim();
            const taskName = getSelectedTaskName();
            const items = document.getElementById('taskItems').value.trim();
            const priority = normalizeTaskPriority(document.getElementById('taskPriority').value);
            const usageTime = parseFloat(document.getElementById('taskUsageTime').value);
            const scope = String(document.getElementById('taskScope')?.value || '').trim();
            const startDate = cleanDateStr(document.getElementById('taskStart').value);
            const planDate = cleanDateStr(document.getElementById('taskPlan').value);
            const actualDate = cleanDateStr(document.getElementById('taskActual').value);

            const isOtherTask = normalizeWorkloadKey(taskName) === 'other task';
            if (!category || !taskName || !items || selectedPics.length === 0 || !priority || !isFinite(usageTime) || usageTime <= 0 || !startDate || !planDate || (!scope && !isOtherTask)) {
                validateRequiredFormFields(document.getElementById('taskForm'));
                if(selectedPics.length===0){
                    const picWrap=document.querySelector('.task-pic-checkbox')?.closest('.grid');
                    if(picWrap) markRequiredFieldInvalid(picWrap);
                }
                return;
            }
            if (planDate < startDate) {
                markRequiredFieldInvalid(document.getElementById('taskPlan'));
                markRequiredFieldInvalid(document.getElementById('taskStart'));
                return;
            }
            if (actualDate && actualDate < startDate) {
                markRequiredFieldInvalid(document.getElementById('taskActual'));
                markRequiredFieldInvalid(document.getElementById('taskStart'));
                return;
            }

            const createFingerprint = !id ? makeCreateFingerprint('task',[category,taskName,items,selectedPics.join(','),startDate,planDate,actualDate,usageTime,scope]) : '';
            if(!beginFormSave('taskForm', createFingerprint)) return;

            try {
                const existingTask = id ? dailyTasks.find(t=>String(t.id)===String(id)) : null;
                // New tasks must NOT use Date.now() as a database id. public.tasks.id is
                // an identity column; a temporary client id is used only until INSERT returns.
                const newId = existingTask ? existingTask.id : `tmp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
                let newTask = {
                    id: newId, category, name: taskName, items, scope, priority,
                    pic: selectedPics.join(', '), pics: selectedPics,
                    start: startDate, plan: planDate, actual: actualDate,
                    startDate, planDate, actualDate, usageTime,
                    createdBy: existingTask?.createdBy || currentUser?.name || '',
                    createdAt: existingTask?.createdAt || new Date().toISOString(),
                    savedAt: new Date().toISOString()
                };
                if (existingTask && existingTask.projectId !== undefined) newTask.projectId = existingTask.projectId;
                newTask = calculateTaskMetadata(newTask);

                const idx = id ? dailyTasks.findIndex(t => String(t.id) === String(id)) : -1;
                if (idx !== -1) dailyTasks[idx] = newTask; else dailyTasks.unshift(newTask);
                applyGlobalFilters();

                // Save the single task directly. This avoids sending the whole task table
                // on every new task and guarantees that the identity id is generated by DB.
                await saveTaskRecordDirect(newTask);
                closeTaskModal();
                applyGlobalFilters();

                // Capacity is a secondary calculation. It must never make an otherwise
                // successful Task insert look like a failed Task save.
                try {
                    await syncCapacityWorkloadsFromTasks();
                } catch (capacityErr) {
                    console.error('Capacity sync after task save failed:', capacityErr);
                }

                try {
                    await sendPowerAutomateAssignmentNotification({
                        type: 'task',
                        creator: newTask.createdBy || currentUser?.name || '',
                        assignees: selectedPics,
                        planDate: newTask.planDate || newTask.plan,
                        recordId: newTask.id,
                        item: newTask.items,
                        priority: newTask.priority
                    });
                } catch (notifyErr) {
                    console.error('Power Automate task notification error:', notifyErr);
                }
                showToast(existingTask ? 'Task updated' : 'Task saved');
            } catch(err) {
                forgetCreateFingerprint(createFingerprint);
                console.error('Task save error:', err);
                showAppNotification(`Unable to save task. ${err?.message || err || 'Unknown error'}`, 'Save Error');
                await fetchAllDataFromSheet({background:false});
            } finally {
                endFormSave('taskForm');
            }
        }

        async function deleteDailyTask(id) {
            const task = dailyTasks.find(t=>String(t.id)===String(id)); if (!task || !assertCanEditTask(task)) return;
            const ok = await showAppConfirm("Delete this task?");
            if (!ok) return;
            const deletedKey = stableRowKey('Tasks', task);
            pendingRowDeletions.Tasks.add(deletedKey);
            dailyTasks = dailyTasks.filter(t => String(t.id) !== String(id));
            // Deleting a Gantt "Project Processing" row must also clear that day's hours in the project.
            let projectChanged = false;
            if (isProjectHoursTask(task) && task.projectId!==undefined && task.projectId!=='') {
                const p = projectsList.find(x=>String(x.id)===String(task.projectId));
                const d = cleanDateStr(task.start||task.plan||task.actual);
                const stillUsed = dailyTasks.some(t=>isProjectHoursTask(t) && String(t.projectId??'')===String(task.projectId) && cleanDateStr(t.start||t.plan||t.actual)===d);
                if (p && p.hoursUsed && d && p.hoursUsed[d] !== undefined && !stillUsed) { delete p.hoursUsed[d]; projectChanged = true; }
            }
            applyGlobalFilters();
            if (projectChanged) renderGanttChart();
            try {
                // Delete exactly this Task record instead of relying on the full-table snapshot diff.
                await deleteTaskRecordDirect(task);
                await syncCapacityWorkloadsFromTasks();
                if(projectChanged) await saveSheetData('Projects', projectsList);
                pendingRowDeletions.Tasks.delete(deletedKey);
                showToast('Task deleted');
            } catch(err) {
                console.error('Task delete sync error:', err);
                pendingRowDeletions.Tasks.delete(deletedKey);
                showAppNotification(`Unable to delete task. ${err?.message || err || 'Unknown error'}`, 'Delete Error');
                await fetchAllDataFromSheet({background:false});
            }
        }

        function editDailyTask(id) {
            const task = dailyTasks.find(t => String(t.id) === String(id));
            if (!document.getElementById('taskModal')) { throw new Error('Task edit modal (#taskModal) was not found in the page.'); }
            if (!task || !assertCanEditTask(task)) return;
            document.getElementById('taskId').value = String(task.id);
            document.getElementById('taskModalTitle').innerText = 'Edit Task';
            { const sel = document.getElementById('taskCategory');
              if (task.category && !Array.from(sel.options).some(o => o.value === task.category)) sel.add(new Option(task.category, task.category));
              sel.value = task.category; }
            const taskCategorySearch = document.getElementById('taskCategorySearch');
            if (taskCategorySearch) taskCategorySearch.value = task.category || '';
            onTaskCategoryChange();
            const taskNameOption = Array.from(document.getElementById('taskNameSelect').options).find(o => o.value === task.name);
            if (taskNameOption) {
                document.getElementById('taskNameSelect').value = task.name;
            } else if (String(task.category || '').trim().toLowerCase() === 'other') {
                document.getElementById('taskNameSelect').value = '__OTHER_NEW__';
                onTaskNameChange();
                document.getElementById('taskNameOther').value = task.name || '';
            } else {
                document.getElementById('taskNameSelect').value = task.name;
            }
            const taskNameSearch = document.getElementById('taskNameSearch');
            if (taskNameSearch) taskNameSearch.value = task.name || '';
            document.getElementById('taskItems').value = task.items;
            document.getElementById('taskPriority').value = projectPriorityToTaskPriority(task.priority);
            
            let taskPics = task.pics && task.pics.length > 0 ? task.pics : (task.pic ? String(task.pic).split(',').map(s => s.trim()) : []);
            renderPICCheckboxLists();
            const checkboxes = document.querySelectorAll('.task-pic-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = taskPics.includes(cb.value);
            });

            document.getElementById('taskStart').value = task.start;
            document.getElementById('taskPlan').value = task.plan;
            document.getElementById('taskActual').value = task.actual;
            document.getElementById('taskUsageTime').value = task.usageTime;
            const taskScopeEl=document.getElementById('taskScope'); if(taskScopeEl){ taskScopeEl.value=task.scope || getDailyTaskScope(task) || ''; updateTaskScopeSuggestion(true); }
            document.getElementById('taskModal').classList.remove('opacity-0', 'pointer-events-none');
            document.body.classList.add('modal-active');
        }

        function getNextMonthSaturdays() {
            const now = new Date();
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            const year = nextMonth.getFullYear();
            const month = nextMonth.getMonth();
            const saturdays = [];

            let d = new Date(year, month, 1);
            while (d.getMonth() === month) {
                if (d.getDay() === 6) {
                    saturdays.push(formatDateLocal(d));
                }
                d.setDate(d.getDate() + 1);
            }
            return saturdays;
        }

        function onTimeoffTypeChange() {
            const type = document.getElementById('timeoffType').value;
            const hoursInput = document.getElementById('timeoffHours');
            const hoursContainer = document.getElementById('timeoffHoursContainer');
            const datesGroup = document.getElementById('datesInputGroup');
            const satContainer = document.getElementById('saturdaySelectContainer');
            const reasonContainer = document.getElementById('timeoffReasonContainer');
            const reasonInput = document.getElementById('timeoffReason');
            const startDateInput = document.getElementById('timeoffStartDate');
            const endDateInput = document.getElementById('timeoffEndDate');

            if (type === 'Saturday Off') {
                datesGroup.classList.add('hidden');
                hoursContainer.classList.add('hidden');
                satContainer.classList.remove('hidden');

                const sats = getNextMonthSaturdays();
                const listDiv = document.getElementById('saturdayOptionsList');
                const picVal = document.getElementById('timeoffPIC').value;

                listDiv.innerHTML = sats.map(sDate => {
                    const exists = timeoffOtList.some(item =>
                        item.type === 'Saturday Off' &&
                        item.pic === picVal &&
                        cleanDateStr(item.startDate) === sDate
                    );
                    return `
                        <label class="flex items-center space-x-2">
                            <input type="checkbox" name="satDates" value="${sDate}" class="rounded border-slate-300" ${exists ? 'checked' : ''}>
                            <span>Saturday (${formatDateMMDDYYYY(sDate)})</span>
                        </label>
                    `;
                }).join('');

                startDateInput.required = false;
                endDateInput.required = false;
                hoursInput.required = false;
            } else {
                datesGroup.classList.remove('hidden');
                hoursContainer.classList.remove('hidden');
                satContainer.classList.add('hidden');

                startDateInput.required = true;
                endDateInput.required = true;
                hoursInput.required = true;

                hoursInput.readOnly = false;
                document.getElementById('timeoffAmountLabel').innerText =
                    (type === 'Over Time' || type === 'Time Off') ? "Hours" : "Days";
            }

            if (type === 'Over Time') {
                reasonContainer.classList.remove('hidden');
                reasonInput.required = true;
                if(startDateInput.value) {
                    endDateInput.value = startDateInput.value;
                }
            } else {
                reasonContainer.classList.add('hidden');
                reasonInput.required = false;
            }
            onTimeoffDatesChange();
        }

        function onTimeoffDatesChange() {
            const type = document.getElementById('timeoffType').value;
            const start = document.getElementById('timeoffStartDate').value;
            const endDateInput = document.getElementById('timeoffEndDate');

            if (type === 'Over Time' && start) {
                endDateInput.value = start;
            }

            const end = endDateInput.value;
            const hoursInput = document.getElementById('timeoffHours');

            if (start && end && type !== 'Saturday Off') {
                const d1 = new Date(start);
                const d2 = new Date(end);
                const diffTime = Math.abs(d2 - d1);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

                if (type === 'Over Time' || type === 'Time Off') {
                    hoursInput.min = '0.25';
                    hoursInput.max = '24';
                    hoursInput.step = '0.25';
                    hoursInput.inputMode = 'decimal';
                    if(!hoursInput.value || Number(hoursInput.value) <= 0) {
                        hoursInput.value = type === 'Over Time' ? 2 : 1;
                    }
                } else {
                    hoursInput.value = diffDays;
                    hoursInput.max = diffDays;
                    hoursInput.min = 0.5;
                    hoursInput.step = 0.5;
                }
            }
        }

        async function handleTimeoffOtSubmit(e) {
            e.preventDefault();
            const form=document.getElementById('timeoffOtForm');
            const typeEl=document.getElementById('timeoffType');
            const picEl=document.getElementById('timeoffPIC');
            const type = String(typeEl?.value || '').trim();
            const pic = String(picEl?.value || '').trim();
            const editId = document.getElementById('timeoffEditId').value;
            const startEl=document.getElementById('timeoffStartDate');
            const endEl=document.getElementById('timeoffEndDate');
            const hoursEl=document.getElementById('timeoffHours');
            const reasonEl=document.getElementById('timeoffReason');

            // Use application validation instead of browser native validation so hidden
            // fields (e.g. Saturday Off) can never incorrectly block a valid submission.
            [typeEl,picEl,startEl,endEl,hoursEl,reasonEl].forEach(clearRequiredFieldInvalid);
            let formValid=true;
            if(!type){ markRequiredFieldInvalid(typeEl); formValid=false; }
            if(!pic){ markRequiredFieldInvalid(picEl); formValid=false; }
            if(type==='Saturday Off'){
                const checkedSats=document.querySelectorAll('input[name="satDates"]:checked');
                if(!checkedSats.length){ markRequiredFieldInvalid(document.getElementById('saturdaySelectContainer')); formValid=false; }
            }else{
                const start=cleanDateStr(startEl?.value);
                const end=cleanDateStr(endEl?.value);
                const hours=Number(hoursEl?.value);
                if(!start){ markRequiredFieldInvalid(startEl); formValid=false; }
                if(!end || end<start){ markRequiredFieldInvalid(endEl); formValid=false; }
                if(!Number.isFinite(hours) || hours<=0 || hours>24){ markRequiredFieldInvalid(hoursEl); formValid=false; }
                if(type==='Over Time' && !String(reasonEl?.value || '').trim()){ markRequiredFieldInvalid(reasonEl); formValid=false; }
            }
            if(!formValid){
                showAppNotification('Please complete all required fields before saving.', 'Missing Required Field');
                return;
            }
            const hoursRaw = document.getElementById('timeoffHours')?.value ?? '';
            const startRaw = document.getElementById('timeoffStartDate')?.value ?? '';
            const endRaw = document.getElementById('timeoffEndDate')?.value ?? '';
            const reasonRaw = document.getElementById('timeoffReason')?.value ?? '';
            const checkedRaw = type === 'Saturday Off' ? Array.from(document.querySelectorAll('input[name="satDates"]:checked')).map(c=>c.value).sort().join(',') : '';
            const createFingerprint = !editId ? makeCreateFingerprint('timeoff',[type,pic,startRaw,endRaw,hoursRaw,reasonRaw,checkedRaw]) : '';
            if(!beginFormSave('timeoffOtForm', createFingerprint)) return;
            try {
            if (type === 'Saturday Off') {
                const checkedSats = Array.from(document.querySelectorAll('input[name="satDates"]:checked')).map(c => c.value);
                if (checkedSats.length === 0) {
                    const satWrap=document.getElementById('saturdaySelectContainer');
                    if(satWrap) markRequiredFieldInvalid(satWrap);
                    return;
                }
                if (editId) timeoffOtList = timeoffOtList.filter(item => String(item.id) !== String(editId));
                checkedSats.forEach(sDate => {
                    const exists = timeoffOtList.some(item =>
                        String(item.type || '').trim().toLowerCase() === 'saturday off' &&
                        String(item.pic || '').trim().toLowerCase() === String(pic || '').trim().toLowerCase() &&
                        cleanDateStr(item.startDate) === sDate
                    );
                    if (!exists) {
                        timeoffOtList.unshift({
                            id: `tmp_timeoff_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
                            type: 'Saturday Off', pic, startDate: cleanDateStr(sDate), endDate: cleanDateStr(sDate),
                            hours: 6.5, reason: 'Saturday Off Registration'
                        });
                    }
                });
            } else {
                const hoursVal = parseFloat(document.getElementById('timeoffHours').value) || 0;
                const start = cleanDateStr(document.getElementById('timeoffStartDate').value);
                const end = cleanDateStr(document.getElementById('timeoffEndDate').value);
                if (!start || !end || end < start || !Number.isFinite(hoursVal) || hoursVal <= 0 || hoursVal > 24) {
                    validateRequiredFormFields(document.getElementById('timeoffOtForm'));
                    if(!start) markRequiredFieldInvalid(document.getElementById('timeoffStartDate'));
                    if(!end || end < start) markRequiredFieldInvalid(document.getElementById('timeoffEndDate'));
                    if(!Number.isFinite(hoursVal) || hoursVal <= 0 || hoursVal > 24) markRequiredFieldInvalid(document.getElementById('timeoffHours'));
                    return;
                }
                const payload = { id: editId || `tmp_timeoff_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, type, pic, startDate:start, endDate:end, hours:hoursVal, reason:document.getElementById('timeoffReason').value };
                if (editId) {
                    const idx = timeoffOtList.findIndex(item => String(item.id) === String(editId));
                    if (idx >= 0) timeoffOtList[idx] = payload;
                } else {
                    timeoffOtList.unshift(payload);
                }
            }

            await saveSheetData("TimeOff_OT", timeoffOtList);
            document.getElementById('timeoffOtForm').reset();
            document.getElementById('timeoffEditId').value = '';
            document.getElementById('timeoffSubmitBtn').innerHTML = '<i class="fa-solid fa-paper-plane mr-1"></i> Submit Request';
            onTimeoffTypeChange();
            renderTimeoffOtTable();
            renderWeeklyCalendar();
            renderSaturdayMatrixTable();
            showAppNotification(editId ? "Request updated successfully." : "Submitted & saved successfully.");
            } catch(err) {
                forgetCreateFingerprint(createFingerprint);
                console.error('Time Off / Overtime save error:', err);
                showAppNotification(`Unable to save request. ${err?.message || err || 'Unknown error'}`, 'Save Error');
            } finally {
                endFormSave('timeoffOtForm');
            }
        }

        function populateTimeoffEditOptions(){
            const typeEl=document.getElementById('timeoffEditType'), picEl=document.getElementById('timeoffEditPIC'); if(!typeEl||!picEl)return;
            typeEl.innerHTML=['Day Off','Saturday Off','Over Time','Time Off'].map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
            const names=canonicalPersonList((Array.isArray(users)?users:[]).filter(u=>String(u?.status||'').trim().toLowerCase()==='active').map(u=>u?.name||u?.username||'')).sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
            picEl.innerHTML=names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
        }
        function onTimeoffEditTypeChange(){
            const type=document.getElementById('timeoffEditType')?.value||'Day Off', hours=document.getElementById('timeoffEditHours'), label=document.getElementById('timeoffEditAmountLabel'), reason=document.getElementById('timeoffEditReasonWrap'), end=document.getElementById('timeoffEditEnd'), start=document.getElementById('timeoffEditStart');
            if(type==='Saturday Off'){label.textContent='Hours'; hours.value=hours.value||6.5; hours.readOnly=true; end.readOnly=true; end.value=start.value||end.value; reason.classList.remove('hidden');}
            else {hours.readOnly=false; label.textContent=(type==='Over Time'||type==='Time Off')?'Hours':'Days'; reason.classList.toggle('hidden',type!=='Over Time'); end.readOnly=type==='Over Time'; if(type==='Over Time'&&start.value)end.value=start.value;}
        }
        function openTimeoffEditModal(id){
            const item=timeoffOtList.find(i=>String(i.id)===String(id)); if(!item)return; populateTimeoffEditOptions();
            document.getElementById('timeoffEditModalId').value=item.id; document.getElementById('timeoffEditType').value=item.type||'Day Off'; document.getElementById('timeoffEditPIC').value=item.pic||'';
            document.getElementById('timeoffEditStart').value=cleanDateStr(item.startDate); document.getElementById('timeoffEditEnd').value=cleanDateStr(item.endDate||item.startDate); document.getElementById('timeoffEditHours').value=item.hours??''; document.getElementById('timeoffEditReason').value=item.reason||'';
            onTimeoffEditTypeChange(); document.getElementById('timeoffEditStart').onchange=()=>onTimeoffEditTypeChange();
            document.getElementById('timeoffEditModal').classList.remove('opacity-0','pointer-events-none'); document.body.classList.add('modal-active');
        }
        function closeTimeoffEditModal(){document.getElementById('timeoffEditModal').classList.add('opacity-0','pointer-events-none');document.body.classList.remove('modal-active');}
        async function saveTimeoffEdit(e){
            e.preventDefault(); const id=document.getElementById('timeoffEditModalId').value, idx=timeoffOtList.findIndex(i=>String(i.id)===String(id)); if(idx<0)return;
            const type=document.getElementById('timeoffEditType').value, pic=document.getElementById('timeoffEditPIC').value, start=cleanDateStr(document.getElementById('timeoffEditStart').value), end=cleanDateStr(document.getElementById('timeoffEditEnd').value||start), hours=Number(document.getElementById('timeoffEditHours').value)||0, reason=document.getElementById('timeoffEditReason').value.trim();
            if(!start||!end||end<start||hours<=0||(type==='Over Time'&&!reason)){validateRequiredFormFields(document.getElementById('timeoffEditForm'));if(!start)markRequiredFieldInvalid(document.getElementById('timeoffEditStart'));if(!end||end<start)markRequiredFieldInvalid(document.getElementById('timeoffEditEnd'));if(hours<=0)markRequiredFieldInvalid(document.getElementById('timeoffEditHours'));if(type==='Over Time'&&!reason)markRequiredFieldInvalid(document.getElementById('timeoffEditReason'));return;}
            timeoffOtList[idx]={...timeoffOtList[idx],type,pic,startDate:start,endDate:(type==='Over Time'||type==='Saturday Off')?start:end,hours,reason:type==='Saturday Off'?(reason||'Saturday Off Registration'):reason};
            await saveSheetData('TimeOff_OT',timeoffOtList); closeTimeoffEditModal(); renderTimeoffOtTable(); renderWeeklyCalendar(); renderSaturdayMatrixTable(); showAppNotification('Request updated successfully.');
        }

        function renderTimeoffOtTable() {
            const tbody = document.getElementById('timeoffOtTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const requestRows = [...timeoffOtList].sort((a,b)=>{
                const ad=Number(a.id)||0, bd=Number(b.id)||0;
                if(ad!==bd) return bd-ad;
                return String(b.startDate||'').localeCompare(String(a.startDate||''));
            });
            requestRows.forEach((item, index) => {
                const tr = document.createElement('tr');
                tr.className = "border-b border-slate-100";

                let badgeClass = 'bg-blue-100 text-blue-800';
                if(item.type === 'Over Time') badgeClass = 'bg-amber-100 text-amber-800';
                if(item.type === 'Saturday Off') badgeClass = 'bg-purple-100 text-purple-800';
                if(item.type === 'Time Off') badgeClass = 'bg-cyan-100 text-cyan-800';

                tr.innerHTML = `
                    <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass}">${escapeHtml(item.type)}</span></td>
                    <td class="py-2.5 px-3 font-semibold">${escapeHtml(item.pic)}</td>
                    <td class="py-2.5 px-3 text-slate-600">${formatDateMMDDYYYY(item.startDate)} → ${formatDateMMDDYYYY(item.endDate)}</td>
                    <td class="py-2.5 px-3 text-center font-bold">${item.hours} ${item.type==='Over Time'||item.type==='Saturday Off'||item.type==='Time Off'?'hrs':'days'}</td>
                    <td class="py-2.5 px-3 text-slate-500 truncate max-w-xs">${escapeHtml(item.reason || '-')}</td>
                    <td class="py-2.5 px-3 text-center whitespace-nowrap">
                        <button onclick="openTimeoffEditModal(${JSON.stringify(item.id)})" class="text-slate-400 hover:text-indigo-600 mr-2" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="deleteTimeoffOt(${JSON.stringify(item.id)})" class="text-slate-400 hover:text-red-600" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
            restoreAdvancedTableFilters();
        }

        async function deleteTimeoffOt(id) {
            const ok = await showAppConfirm("Delete this record?");
            if (!ok) return;
            const deletedTimeoff=timeoffOtList.find(i=>String(i.id)===String(id));
            if(deletedTimeoff) pendingRowDeletions.TimeOff_OT.add(stableRowKey('TimeOff_OT',deletedTimeoff));
            timeoffOtList = timeoffOtList.filter(i => i.id != id);
            await saveSheetData("TimeOff_OT", timeoffOtList);
            if(deletedTimeoff) pendingRowDeletions.TimeOff_OT.delete(stableRowKey('TimeOff_OT',deletedTimeoff));
            renderTimeoffOtTable();
            renderWeeklyCalendar();
            renderSaturdayMatrixTable();
        }

        function renderSaturdayMatrixTable() {
            const headerRow = document.getElementById('saturdayMatrixHeader');
            const tbody = document.getElementById('saturdayMatrixBody');
            const monthInput = document.getElementById('saturdayMatrixMonth');
            if(!headerRow || !tbody || !monthInput) return;

            const [yearStr, monthStr] = monthInput.value.split('-');
            const year = parseInt(yearStr);
            const month = parseInt(monthStr) - 1;

            const saturdays = [];
            let d = new Date(year, month, 1);
            while (d.getMonth() === month) {
                if (d.getDay() === 6) saturdays.push(formatDateLocal(d));
                d.setDate(d.getDate() + 1);
            }

            headerRow.innerHTML = `<th class="py-2.5 px-4">Member Name</th>` + saturdays.map(s => `<th class="py-2.5 px-2 text-center">Sat (${formatDateMMDDYYYY(s)})</th>`).join('');
            tbody.innerHTML = '';

            const activeUsers = users.filter(u => u.status === 'Active' && !isHiddenMember(u.name));
            activeUsers.forEach(u => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 border-b";
                let rowHtml = `<td class="py-2.5 px-4 font-bold text-slate-800">${u.name}</td>`;

                saturdays.forEach(sDate => {
                    const exists = timeoffOtList.some(item => {
                        const type = String(item.type || '').trim().toLowerCase();
                        const itemPic = String(item.pic || '').trim().toLowerCase();
                        const memberPic = String(u.name || '').trim().toLowerCase();
                        const start = cleanDateStr(item.startDate);
                        const end = cleanDateStr(item.endDate || item.startDate);
                        return type === 'saturday off' &&
                               itemPic === memberPic &&
                               start && end &&
                               start <= sDate && sDate <= end;
                    });
                    rowHtml += `
                        <td class="py-2.5 px-2 text-center">
                            <input type="checkbox" ${exists ? 'checked' : ''} onchange="toggleSaturdayMatrix('${u.name}', '${sDate}', this.checked)" class="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer">
                        </td>
                    `;
                });
                tr.innerHTML = rowHtml;
                tbody.appendChild(tr);
            });
        }

        async function toggleSaturdayMatrix(pic, sDate, isChecked) {
            const normalizedPic = String(pic || '').trim().toLowerCase();
            const normalizedDate = cleanDateStr(sDate);
            const pending = pendingRowDeletions.TimeOff_OT || (pendingRowDeletions.TimeOff_OT = new Set());

            if (isChecked) {
                const exists = timeoffOtList.some(item =>
                    String(item.type || '').trim().toLowerCase() === 'saturday off' &&
                    String(item.pic || '').trim().toLowerCase() === normalizedPic &&
                    cleanDateStr(item.startDate) === normalizedDate
                );
                if (!exists) {
                    timeoffOtList.unshift({
                        id: `tmp_timeoff_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
                        type: 'Saturday Off',
                        pic: pic,
                        startDate: normalizedDate,
                        endDate: normalizedDate,
                        hours: 6.5,
                        reason: 'Saturday Matrix Registration'
                    });
                }
            } else {
                // IMPORTANT: removing the row from the local array is not enough.
                // runSimpleTableSave() only deletes database rows that are explicitly
                // placed in pendingRowDeletions, so mark every matching existing row
                // for deletion before removing it locally. This keeps the checkbox and
                // Supabase database state synchronized.
                const rowsToDelete = timeoffOtList.filter(item => {
                    const type = String(item.type || '').trim().toLowerCase();
                    const itemPic = String(item.pic || '').trim().toLowerCase();
                    const start = cleanDateStr(item.startDate);
                    const end = cleanDateStr(item.endDate || item.startDate);
                    return type === 'saturday off' &&
                           itemPic === normalizedPic &&
                           start && end && start <= normalizedDate && normalizedDate <= end;
                });

                rowsToDelete.forEach(item => {
                    if (item && item.id !== undefined && item.id !== null && String(item.id) !== '') {
                        pending.add(stableRowKey('TimeOff_OT', item));
                    }
                });

                timeoffOtList = timeoffOtList.filter(item => !rowsToDelete.includes(item));
            }

            try {
                await saveSheetData('TimeOff_OT', timeoffOtList);

                // The database deletion has completed successfully, so clear only the
                // deletion keys that belong to this Saturday/PIC.
                if (!isChecked) {
                    // Use the original database rows from the current sync snapshot to
                    // clear the exact keys that were just processed.
                    const snapshot = sheetSyncSnapshots.TimeOff_OT || [];
                    snapshot.forEach(item => {
                        const type = String(item.type || '').trim().toLowerCase();
                        const itemPic = String(item.pic || '').trim().toLowerCase();
                        const start = cleanDateStr(item.startDate);
                        const end = cleanDateStr(item.endDate || item.startDate);
                        if (type === 'saturday off' && itemPic === normalizedPic && start && end && start <= normalizedDate && normalizedDate <= end) {
                            pending.delete(stableRowKey('TimeOff_OT', item));
                        }
                    });
                }

                renderTimeoffOtTable();
                renderWeeklyCalendar();
                renderSaturdayMatrixTable();
            } catch (err) {
                // If persistence fails, refresh from the database so the checkbox does
                // not falsely indicate that the change was saved.
                await fetchAllDataFromSheet({background: true, forceRender: true}).catch(() => {});
                throw err;
            }
        }

        const expandedProjectRows = new Set();
        const projectInlineSaveTimers = new Map();
        let projectDragState = null;
        function applyExpandedProjectRowState(row, rowId){
            if(!row) return;
            const expanded=expandedProjectRows.has(String(rowId));
            row.classList.toggle('project-row-expanded',expanded);
        }
        function toggleProjectRowExpand(rowId){
            const key=String(rowId);
            if(expandedProjectRows.has(key)) expandedProjectRows.delete(key); else expandedProjectRows.add(key);
            renderProjectsTable();
            requestAnimationFrame(()=>{
                const row=document.getElementById(`project-row-${rowId}`);
                if(row) row.scrollIntoView({block:'nearest',behavior:'smooth'});
            });
        }
        function bindProjectRowActions(){
            const tbody=document.getElementById('projectsTableBody');
            if(!tbody || tbody.dataset.boundProjectActions==='1') return;
            tbody.dataset.boundProjectActions='1';
            tbody.addEventListener('click',event=>{
                if(event.target.closest('[data-project-action],.project-grid-input,.project-grid-select,.project-grid-date,.project-add-row')){event.stopPropagation();return;}
            });
        }
        function projectInlineOwnerOptions(selected=''){
            const unique=canonicalPersonList(users.filter(u=>String(u.name||'').trim()).map(u=>u.name));
            return `<option value="">—</option>${unique.map(n=>`<option value="${escapeHtml(n)}" ${normalizePersonKey(n)===normalizePersonKey(selected)?'selected':''}>${escapeHtml(n)}</option>`).join('')}`;
        }
        function projectStatusOptions(selected){
            const opts=['Not Started','Working','Completed','Overdue','Stuck'];
            return opts.map(x=>`<option value="${x}" ${String(selected||'')===x?'selected':''}>${x}</option>`).join('');
        }
        function projectStatusClass(status){return String(status||'Not Started').toLowerCase().replace(/[^a-z]+/g,'-');}
        function calculateProjectOverallStatus(project){
            const allTasks=[
                ...(Array.isArray(project?.phases)?project.phases:[]).flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]),
                ...(Array.isArray(project?.tasks)?project.tasks:[])
            ];
            if(!allTasks.length) return 'Not Started';
            const statuses=allTasks.map(t=>calculateProjectTaskStatus(t));
            if(statuses.every(x=>x==='Completed')) return 'Completed';
            if(statuses.some(x=>x==='Overdue')) return 'Overdue';
            if(statuses.some(x=>x==='Working')) return 'Working';
            return 'Not Started';
        }
        function projectIncompleteTaskDetails(project){
            const tasks=[...(Array.isArray(project?.phases)?project.phases:[]).flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]),...(Array.isArray(project?.tasks)?project.tasks:[])];
            if(!tasks.length) return '';
            const incomplete=tasks.filter(t=>calculateProjectTaskStatus(t)!=='Completed');
            if(!incomplete.length) return 'Completed';
            const details=[];
            incomplete.forEach(t=>{
                const detail=String(t?.detail||'').trim();
                if(detail) details.push({name:String(t?.name||'').trim(),detail});
            });
            if(!details.length) return '';
            if(details.length===1) return details[0].detail;
            return details.map((x,i)=>`${i+1}. ${x.name ? x.name+': ' : ''}${x.detail}`).join('\n');
        }
        function projectRowDetailedStatus(project){
            const own=String(project?.detailedStatus||'').trim();
            const child=projectIncompleteTaskDetails(project);
            const parts=[];
            if(own) parts.push(own);
            if(child && child!=='Completed' && child!==own) parts.push(child);
            if(!parts.length && child==='Completed') return 'Completed';
            return parts.join('\n');
        }
        function projectDetailedStatusHtml(value){
            const v=String(value||'').trim();
            if(!v) return '<span class="pm-ref-empty">-</span>';
            if(v==='Completed') return '<span class="pm-ref-detail-badge on-track">Completed</span>';
            const lines=v.split('\n').filter(Boolean);
            return `<div class="pm-project-detail-list">${lines.map(line=>`<span class="pm-detail-line">${escapeHtml(line)}</span>`).join('')}</div>`;
        }
        function refreshProjectDetailedStatusDisplay(projectId){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p)return;
            const row=document.querySelector(`#projectsTableBody .pm-ref-project-data-row[data-project-id="${CSS.escape(String(projectId))}"]`);
            if(!row)return;
            const cell=row.querySelector('.pm-project-detail-cell');
            if(cell)cell.innerHTML=projectDetailedStatusHtml(projectRowDetailedStatus(p));
        }
        function updateProjectInlineTaskDetailRealtime(projectId,phaseIndex,taskIndex,value){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p)return;
            const list=getProjectInlineTaskList(p,phaseIndex),t=list[taskIndex];
            if(!t)return;
            t.detail=String(value??'');
            t.status=calculateProjectTaskStatus(t);
            syncProjectOverallStatus(p);
            refreshProjectDetailedStatusDisplay(projectId);
            queueProjectInlineSave(projectId);
        }
        function syncProjectOverallStatus(project){
            if(!project) return 'Not Started';
            const status=calculateProjectOverallStatus(project);
            project.status=status;
            return status;
        }
        function projectOwnerText(item){return Array.isArray(item?.owners)?item.owners.join(', '):String(item?.owner||'').trim();}
        function projectNumber(v){
            if(v===''||v===null||v===undefined||Number.isNaN(Number(v)))return '';
            return Math.round(Number(v)||0).toLocaleString('en-US',{maximumFractionDigits:0});
        }
        function projectMoney(v){
            if(v===''||v===null||v===undefined||Number.isNaN(Number(v)))return '';
            const n=Math.round(Number(v)||0);
            return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
        }
        function projectParseMoney(v){
            if(v===null||v===undefined)return '';
            let raw=String(v).trim();
            if(!raw)return '';
            raw=raw.replace(/[$€£¥\s]/g,'');
            if(raw.startsWith('(')&&raw.endsWith(')'))raw='-'+raw.slice(1,-1);
            raw=raw.replace(/,/g,'');
            const n=Number(raw);
            return Number.isFinite(n)?n:'';
        }
        function projectPhaseSummary(ph,project){
            const d=deriveProjectPhaseSchedule(ph,project); ph.startDate=d.startDate;ph.dueDate=d.dueDate;ph.actualDate=d.actualDate;
            const tasks=Array.isArray(ph.tasks)?ph.tasks:[];
            const owners=[...new Set(tasks.map(t=>String(t.owner||'').trim()).filter(Boolean))];
            const gain=tasks.reduce((a,t)=>a+(Number(t.gainDemand)||0),0);
            const est=tasks.reduce((a,t)=>a+(Number(t.estSaving)||0),0);
            const act=tasks.reduce((a,t)=>a+(Number(t.actualSaving)||0),0);
            const completed=tasks.filter(t=>calculateProjectTaskStatus(t)==='Completed').length;
            const status=tasks.length&&completed===tasks.length?'Completed':tasks.some(t=>calculateProjectTaskStatus(t)==='Overdue')?'Overdue':tasks.some(t=>calculateProjectTaskStatus(t)==='Working')?'Working':'Not Started';
            const details=[];
            tasks.filter(t=>calculateProjectTaskStatus(t)!=='Completed').forEach(t=>{const detail=String(t?.detail||'').trim();if(detail)details.push({name:String(t?.name||'').trim(),detail});});
            const detailText=details.length===1?details[0].detail:details.map((x,i)=>`${i+1}. ${x.name?x.name+': ':''}${x.detail}`).join('\n');
            const note=[...new Set(tasks.map(t=>String(t.note||'').trim()).filter(Boolean))].join(' • ');
            return {startDate:d.startDate,dueDate:d.dueDate,actualDate:d.actualDate,owner:owners.join(', '),gainDemand:gain,saving:est,actualSaving:act,detail:detailText,status,note};
        }
        function projectAggregateSummary(project){
            const phases=Array.isArray(project?.phases)?project.phases:[];
            const sums=phases.map(ph=>projectPhaseSummary(ph,project));
            const direct=Array.isArray(project?.tasks)?project.tasks:[];
            const gain=sums.reduce((a,x)=>a+(Number(x.gainDemand)||0),0)+direct.reduce((a,t)=>a+(Number(t.gainDemand)||0),0);
            const saving=sums.reduce((a,x)=>a+(Number(x.saving)||0),0)+direct.reduce((a,t)=>a+(Number(t.estSaving)||0),0);
            const actualSaving=sums.reduce((a,x)=>a+(Number(x.actualSaving)||0),0)+direct.reduce((a,t)=>a+(Number(t.actualSaving)||0),0);
            return {gainDemand:gain,saving,actualSaving};
        }
        function projectEffectiveSavingValue(task){
            const actual=projectParseMoney(task?.actualSaving);
            if(actual!=='' && Number.isFinite(Number(actual))) return Number(actual)||0;
            const est=projectParseMoney(task?.estSaving);
            return est!=='' && Number.isFinite(Number(est)) ? Number(est)||0 : 0;
        }
        function calcProjectEffectiveSaving(project){
            const tasks=[...(Array.isArray(project?.phases)?project.phases:[]).flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]),...(Array.isArray(project?.tasks)?project.tasks:[])];
            return tasks.reduce((sum,t)=>sum+projectEffectiveSavingValue(t),0);
        }

        let projectTableSearchText='';
        let projectExpandedInitialized=false;
        const projectPeriodFilterState={Year:new Set(),Month:new Set(),Week:new Set()};
        let projectPeriodDefaultsInitialized=false;
        function projectPeriodValues(){
            const years=new Set(),months=new Set(),weeks=new Set();
            const addDate=v=>{const d=cleanDateStr(v);if(!d)return;const dt=new Date(d+'T00:00:00');years.add(String(dt.getFullYear()));months.add(String(dt.getMonth()+1));weeks.add(String(getIsoWeekNumber(d)));};
            (projectsList||[]).forEach(p=>{[p.startDate,p.dueDate,p.actualDate].forEach(addDate);(p.phases||[]).forEach(ph=>{[ph.startDate,ph.dueDate,ph.actualDate].forEach(addDate);(ph.tasks||[]).forEach(t=>[t.startDate,t.dueDate,t.actualDate].forEach(addDate));});(p.tasks||[]).forEach(t=>[t.startDate,t.dueDate,t.actualDate].forEach(addDate));});
            return {Year:[...years].sort((a,b)=>Number(a)-Number(b)),Month:[...months].sort((a,b)=>Number(a)-Number(b)),Week:[...weeks].sort((a,b)=>Number(a)-Number(b))};
        }
        function projectPeriodMatchesDate(v){
            const d=cleanDateStr(v);if(!d)return false;const dt=new Date(d+'T00:00:00');
            if(projectPeriodFilterState.Year.size&&!projectPeriodFilterState.Year.has(String(dt.getFullYear())))return false;
            if(projectPeriodFilterState.Month.size&&!projectPeriodFilterState.Month.has(String(dt.getMonth()+1)))return false;
            if(projectPeriodFilterState.Week.size&&!projectPeriodFilterState.Week.has(String(getIsoWeekNumber(d))))return false;
            return true;
        }
        function projectPeriodMatches(project){
            const active=Object.values(projectPeriodFilterState).some(s=>s.size);if(!active)return true;
            const dates=[project?.startDate,project?.dueDate,project?.actualDate];
            (project?.phases||[]).forEach(ph=>{dates.push(ph.startDate,ph.dueDate,ph.actualDate);(ph.tasks||[]).forEach(t=>dates.push(t.startDate,t.dueDate,t.actualDate));});
            (project?.tasks||[]).forEach(t=>dates.push(t.startDate,t.dueDate,t.actualDate));
            return dates.some(projectPeriodMatchesDate);
        }
        function initProjectPeriodDefaults(){
            if(projectPeriodDefaultsInitialized || !(projectsList||[]).length)return;
            const now=new Date(),vals=projectPeriodValues();
            projectPeriodFilterState.Year.clear();projectPeriodFilterState.Month.clear();projectPeriodFilterState.Week.clear();
            const y=String(now.getFullYear()); if(vals.Year.includes(y))projectPeriodFilterState.Year.add(y);
            const m=String(now.getMonth()+1); if(vals.Month.includes(m))projectPeriodFilterState.Month.add(m);
            const w=String(getIsoWeekNumber(formatDateLocal(now))); if(vals.Week.includes(w))projectPeriodFilterState.Week.add(w);
            projectPeriodDefaultsInitialized=true;updateProjectPeriodFilterButtons();
        }
        function updateProjectPeriodFilterButtons(){
            document.querySelectorAll('#tab-projects .pm-project-period-filters .bom-multi').forEach(bar=>{
                const key=bar.dataset.projectPeriodKey,sel=projectPeriodFilterState[key]||new Set(),btn=bar.querySelector('.bom-multi-btn');
                if(btn)btn.innerHTML=`<span class="truncate max-w-[90px]" title="${key}: ${[...sel].join(', ')}">${[...sel].length?[...sel].join(', '):key}</span><i class="fa-solid fa-chevron-down text-[9px] ml-auto shrink-0"></i>`;
            });
        }
        function toggleProjectPeriodFilter(btn){
            const bar=btn.parentElement,key=bar.dataset.projectPeriodKey,menu=bar.querySelector('.bom-multi-menu');
            document.querySelectorAll('#tab-projects .pm-project-period-filters .bom-multi-menu').forEach(m=>{if(m!==menu)m.classList.add('hidden')});
            menu.classList.toggle('hidden');if(menu.classList.contains('hidden'))return;
            const vals=projectPeriodValues()[key]||[],sel=projectPeriodFilterState[key]||new Set();
            menu.innerHTML=`<input type="search" placeholder="Search ${key}..." oninput="filterBomOptionSearch(this)">${vals.map(v=>`<label class="bom-multi-option" data-label="${String(v).toLowerCase()}"><input type="checkbox" value="${v}" ${sel.has(v)?'checked':''} onchange="changeProjectPeriodFilter('${key}',this)"><span>${v}</span></label>`).join('')}<div class="flex gap-1 pt-2 border-t mt-1"><button type="button" class="text-[10px] px-2 py-1 bg-slate-100 rounded" onclick="selectProjectPeriodFilter('${key}',true)">All</button><button type="button" class="text-[10px] px-2 py-1 bg-slate-100 rounded" onclick="selectProjectPeriodFilter('${key}',false)">Clear</button></div>`;
            const rect=btn.getBoundingClientRect();let left=rect.left,top=rect.bottom+4;if(left+240>window.innerWidth-8)left=Math.max(8,window.innerWidth-248);if(top+menu.scrollHeight>window.innerHeight-8)top=Math.max(8,rect.top-Math.min(menu.scrollHeight,280)-4);menu.style.left=`${left}px`;menu.style.top=`${top}px`;menu.style.zIndex='2147483647';
        }
        function changeProjectPeriodFilter(key,cb){const s=projectPeriodFilterState[key];if(cb.checked)s.add(cb.value);else s.delete(cb.value);updateProjectPeriodFilterButtons();renderProjectsTable();renderGanttChart();}
        function selectProjectPeriodFilter(key,all){const s=projectPeriodFilterState[key];s.clear();if(all)(projectPeriodValues()[key]||[]).forEach(v=>s.add(v));updateProjectPeriodFilterButtons();renderProjectsTable();renderGanttChart();}

        function setProjectTableSearch(value){
            projectTableSearchText=String(value||'').trim().toLowerCase();
            renderProjectsTable();
            if(projectCurrentView==='gantt') renderGanttChart();
        }

        function projectMatchesSearch(project){
            if(!projectTableSearchText) return true;
            const pText=[
                project.name, project.owner, projectOwnerText(project), project.detail, project.status, project.note,
                project.gainDemand, project.saving, project.actualSaving
            ].join(' ').toLowerCase();
            if(pText.includes(projectTableSearchText)) return true;
            const phases=normalizeProjectPhases(project.phases,project);
            const direct=normalizeProjectTasks(project.tasks,project);
            const tasks=[
                ...phases.flatMap(ph=>Array.isArray(ph.tasks)?ph.tasks:[]),
                ...direct
            ];
            return phases.some(ph=>String(ph.name||'').toLowerCase().includes(projectTableSearchText)) ||
                tasks.some(t=>[
                    t.name,t.owner,t.detail,t.status,t.note,t.gainDemand,t.estSaving,t.actualSaving
                ].join(' ').toLowerCase().includes(projectTableSearchText));
        }

        function projectDetailedStatusClass(value){
            const s=String(value||'').toLowerCase();
            if(/delay|overdue|late/.test(s)) return 'delayed';
            if(/complete|done|on track/.test(s)) return 'on-track';
            if(/progress|working|process/.test(s)) return 'in-progress';
            if(/stuck|block/.test(s)) return 'stuck';
            return 'not-started';
        }

        function projectDetailedStatusBadge(value, editable, onChange){
            const v=String(value||'');
            const cls=projectDetailedStatusClass(v);
            if(editable){
                const safeChange=String(onChange||'').replace(/"/g,'&quot;');
                return `<textarea class="pm-ref-detail-input ${cls}" rows="2" placeholder="Detailed status..." oninput="this.style.height='auto';this.style.height=Math.max(44,this.scrollHeight)+'px'" onchange="${safeChange}">${escapeHtml(v)}</textarea>`;
            }
            return v ? `<span class="pm-ref-detail-badge ${cls}">${escapeHtml(v)}</span>` : `<span class="pm-ref-empty">-</span>`;
        }

        function projectOverallBadge(value, editable, onChange){
            const v=String(value||'Not Started');
            const cls=projectStatusClass(v);
            return `<span class="pm-ref-overall-badge ${cls}" title="Auto calculated from task dates and actual completion">${escapeHtml(v)}</span>`;
        }

        function projectRefDate(value){
            return formatDateMMDDYYYY(cleanDateStr(value)) || '-';
        }

        // Projects without child tasks store their schedule and savings directly on the project row.
        function projectDirectEditCell(project, field, type='text', placeholder=''){
            const id=String(project?.id??'');
            const value=project?.[field]??'';
            const readOnly=!!currentUser?.isReadOnly;
            const cls=type==='date'?'pm-ref-input pm-ref-date pm-project-direct-edit':'pm-ref-input pm-project-direct-edit';
            const inputType=type==='date'?'date':(type==='number'?'number':'text');
            const extra=type==='number'?' step=\"any\"':'';
            return `<input type=\"${inputType}\" class=\"${cls}\" value=\"${escapeHtml(value)}\" placeholder=\"${escapeHtml(placeholder)}\" aria-label=\"${escapeHtml(field)}\" ${readOnly?'disabled':''}${extra} onchange=\"updateProjectDirectField('${id}','${field}',this.value)\">`;
        }
        async function updateProjectDirectField(projectId, field, value){
            if(currentUser?.isReadOnly){showToast('Viewer mode is read-only');return;}
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p)return;
            const allowed=['startDate','dueDate','actualDate','gainDemand','saving','actualSaving','detailedStatus'];
            if(!allowed.includes(field))return;
            const oldValue=p[field];
            let next=value;
            if(['startDate','dueDate','actualDate'].includes(field))next=cleanDateStr(value);
            if(['saving','actualSaving','gainDemand'].includes(field)){
                if(String(value??'').trim()==='') next='';
                else {
                    const parsed=Number(String(value).replace(/[$€£¥,\s]/g,''));
                    if(!Number.isFinite(parsed)){showToast('Please enter a valid number');renderProjectsTable();return;}
                    next=parsed;
                }
            }
            if(field==='startDate' && p.dueDate && next && next>=p.dueDate){showToast('Plan date must be later than Start date');renderProjectsTable();return;}
            if(field==='dueDate' && p.startDate && next && next<=p.startDate){showToast('Plan date must be later than Start date');renderProjectsTable();return;}
            if(field==='actualDate' && next && ((p.startDate&&next<p.startDate)||(p.dueDate&&next>p.dueDate))){showToast('Actual date must be between Start and Plan dates');renderProjectsTable();return;}
            p[field]=next;
            try{
                p.hoursUsed=buildProjectStorageHours(p);
                await saveSheetData('Projects',projectsList);
                renderProjectsTable();renderGanttChart();updateDashboardCharts();
                showToast('Project updated successfully');
            }catch(err){p[field]=oldValue;console.error(err);renderProjectsTable();showToast('Unable to save project change');}
        }

        function projectRefTextInput(value, cls, onChange, placeholder=''){
            return `<input class="pm-ref-input ${cls||''}" value="${escapeHtml(value??'')}" placeholder="${escapeHtml(placeholder)}" onchange="${onChange}">`;
        }

        function projectNextDate(iso){
            const d=cleanDateStr(iso); if(!d)return '';
            const x=new Date(d+'T00:00:00'); if(Number.isNaN(x.getTime()))return ''; x.setDate(x.getDate()+1); return formatDateLocal(x);
        }
        function projectRefDateInput(value, onChange, minDate=''){
            const iso=cleanDateStr(value), min=cleanDateStr(minDate);
            const minAttr=min?`min="${min}"`:'';
            if(!iso){
                return `<input type="text" class="pm-ref-input pm-ref-date pm-ref-date-empty" value="-" aria-label="Empty date" data-date-onchange="${escapeHtml(onChange)}" ${minAttr} onfocus="this.type='date';this.value='';this.classList.remove('pm-ref-date-empty')" onchange="${onChange}" onblur="if(!this.value){this.type='text';this.value='-';this.classList.add('pm-ref-date-empty')}">`;
            }
            return `<input type="date" class="pm-ref-input pm-ref-date" value="${iso}" ${minAttr} onchange="${onChange}">`;
        }

        function projectRefMoneyInput(value, onChange){
            // Display financial values consistently with a dollar sign and thousands separators.
            // Focus switches to a plain editable number; blur restores currency formatting.
            const n=projectParseMoney(value);
            const display=n===''?'':'$'+Math.round(Number(n)).toLocaleString('en-US',{maximumFractionDigits:0});
            const safeChange=String(onChange||'').replace(/"/g,'&quot;');
            return `<input type="text" inputmode="decimal" autocomplete="off" class="pm-ref-input pm-ref-money" value="${escapeHtml(display)}" data-money-value="${n===""?"":Number(n)}" onfocus="this.value=this.value.replace(/[$,\s]/g,'')" onkeydown="if(event.key==='e'||event.key==='E')event.preventDefault();" onchange="this.value=this.value.trim()?'$'+Math.round(Number(String(this.value).replace(/[$,\s]/g,'')||0)).toLocaleString('en-US',{maximumFractionDigits:0}):'';${safeChange}">`;
        }

        function projectInlineTaskRow(p,phaseIndex,task,taskIndex,phaseColor=0,phaseName=''){
            if(!projectFilterMatch({...task,projectName:p.name,phaseName})) return '';
            const phaseTaskClass=`phase-task-color-${phaseColor}`; const pid=String(p.id).replace(/'/g,"\\'"); const status=calculateProjectTaskStatus(task); task.status=status;
            const taskName=String(task.name||'').trim()||`Task ${taskIndex+1}`;
            return `<tr class="pm-ref-task-row ${phaseTaskClass}" ondragover="projectTaskDragOver(event)" ondrop="projectTaskDrop(event,${phaseIndex},${taskIndex},'${pid}')">
                <td class="pm-ref-no pm-row-action-cell"><button type="button" class="pm-row-delete-btn" onclick="deleteProjectInlineTask('${pid}',${phaseIndex},${taskIndex})" title="Delete task" aria-label="Delete task"><i class="fa-solid fa-trash"></i></button></td><td class="pm-ref-phase-empty"><span class="pm-ref-tree-line"></span></td>
                <td class="pm-ref-task-cell">${projectRefTextInput(taskName,'pm-ref-task-input',`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'name',this.value)`)}<span class="pm-ref-drag-handle" draggable="true" ondragstart="event.stopPropagation();projectTaskDragStart(event,${phaseIndex},${taskIndex},'${pid}')" ondragend="projectTaskDragEnd(event)" title="Drag to move"><i class="fa-solid fa-grip-vertical"></i></span></td>
                <td class="pm-ref-owner-cell">${projectTaskOwnerPicker(p,phaseIndex,taskIndex,task.owner)}</td>
                <td>${projectRefDateInput(task.startDate,`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'startDate',this.value)`)}</td>
                <td>${projectRefDateInput(task.dueDate,`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'dueDate',this.value)`,projectNextDate(task.startDate))}</td>
                <td>${projectRefDateInput(task.actualDate,`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'actualDate',this.value)`)}</td>
                <td class="pm-ref-number">${projectRefTextInput(task.gainDemand||'', 'pm-ref-gain-input', `updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'gainDemand',this.value)`,'-')}</td>
                <td class="pm-ref-money">${projectRefMoneyInput(task.estSaving,`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'estSaving',this.value)`)}</td><td class="pm-ref-money">${projectRefMoneyInput(task.actualSaving,`updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'actualSaving',this.value)`)}</td>
                <td>${projectDetailedStatusBadge(task.detail,true,`updateProjectInlineTaskDetailRealtime('${pid}',${phaseIndex},${taskIndex},this.value)`)}</td><td>${projectOverallBadge(status,false,'')}</td><td>${projectRefTextInput(task.note||'', '', `updateProjectInlineTask('${pid}',${phaseIndex},${taskIndex},'note',this.value)`)}</td>
            </tr>`;
        }

        function projectPhaseEntryRow(p,phaseColor){
            const pid=String(p.id).replace(/'/g,"\\'");
            return `<tr class="pm-phase-entry-row phase-color-${phaseColor}">
                <td class="pm-ref-no"></td>
                <td class="pm-ref-phase-cell pm-phase-entry-cell">
                    <span class="pm-ref-tree-line"></span>
                    <input class="pm-ref-input pm-ref-phase-input pm-phase-entry-input" placeholder="Enter new phase..."
                        onkeydown="if(event.key==='Enter'){event.preventDefault();createProjectInlinePhaseFromEntry(this,'${pid}');}"
                        onblur="createProjectInlinePhaseFromEntry(this,'${pid}');">
                </td>
                <td colspan="11"></td>
            </tr>`;
        }
        async function createProjectInlinePhaseFromEntry(input,projectId){
            const el=input&&input.value!==undefined?input:null;
            if(!el)return;
            const v=String(el.value||'').trim();
            if(!v||el.dataset.creating==='1')return;
            el.dataset.creating='1';
            try{
                const saved=await addProjectInlinePhase(projectId,v);
                if(saved && el) el.value='';
            }catch(err){ console.error('Inline phase creation error:',err); }
            finally{ if(el) el.dataset.creating=''; }
        }

        function renderProjectInlineRows(p, projectIndex){
            p.phases=normalizeProjectPhases(p.phases,p);
            p.tasks=normalizeProjectTasks(p.tasks,p);
            const pid=String(p.id).replace(/'/g,"\\'");
            let html='';
            const phases=p.phases||[];

            phases.forEach((ph,pi)=>{
                const sum=projectPhaseSummary(ph,p);
                const phaseColor=pi%8;
                const phaseItem={projectName:p.name,phaseName:ph.name||`Phase ${pi+1}`,name:ph.name||`Phase ${pi+1}`,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note};
                const phaseMatches=projectFilterMatch(phaseItem);
                const matchingTasks=(ph.tasks||[]).map((t,ti)=>({t,ti})).filter(({t})=>projectFilterMatch({...t,projectName:p.name,phaseName:ph.name||`Phase ${pi+1}`}));
                if(Object.keys(projectHeaderFilters).length && !phaseMatches && !matchingTasks.length)return;

                const phaseCollapsed=collapsedProjectPhases.has(projectPhaseCollapseKey(pid,pi));
                html+=`<tr class="pm-ref-phase-row phase-color-${phaseColor}" data-phase-index="${pi}">
                    <td class="pm-ref-no pm-row-action-cell"><button type="button" class="pm-row-delete-btn" onclick="deleteProjectInlinePhase('${pid}',${pi})" title="Delete phase and its tasks" aria-label="Delete phase"><i class="fa-solid fa-trash"></i></button></td>
                    <td class="pm-ref-phase-cell">
                        <button type="button" class="pm-phase-toggle ${phaseCollapsed?'is-collapsed':''}" onclick="toggleProjectPhase('${pid}',${pi})" title="${phaseCollapsed?'Expand':'Collapse'} phase">
                            <i class="fa-solid fa-chevron-down"></i>
                        </button>
                        ${projectRefTextInput(ph.name||`Phase ${pi+1}`,'pm-ref-phase-input',`updateProjectInlinePhase('${pid}',${pi},'name',this.value)`)}
                    </td>
                    <td class="pm-ref-phase-task-summary"><span class="pm-ref-phase-branch"></span></td>
                    <td class="pm-ref-owner-cell">${escapeHtml(sum.owner||'-')}</td>
                    <td>${projectRefDate(sum.startDate)}</td>
                    <td>${projectRefDate(sum.dueDate)}</td>
                    <td>${projectRefDate(sum.actualDate)}</td>
                    <td class="pm-ref-number">${projectNumber(sum.gainDemand)||'-'}</td>
                    <td class="pm-ref-money">${projectMoney(sum.saving)||'-'}</td>
                    <td class="pm-ref-money">${projectMoney(sum.actualSaving)||'-'}</td>
                    <td><span class="pm-ref-empty">-</span></td>
                    <td>${projectOverallBadge(sum.status,false,'')}</td>
                    <td>${escapeHtml(sum.note||'')}</td>
                </tr>`;

                if(!phaseCollapsed){
                    matchingTasks.forEach(({t,ti})=>{
                        html+=projectInlineTaskRow(p,pi,t,ti,phaseColor,ph.name||`Phase ${pi+1}`);
                    });
                    html+=projectTaskEntryRow(p,pi,ph.name||`Phase ${pi+1}`,phaseColor);
                }
            });

            // Keep one dedicated blank phase-entry row for the current project.
            // It is only shown while the project is expanded and does not create
            // duplicate phases unless the user actually enters a value.
            if(!Object.keys(projectHeaderFilters).length || phases.length===0){
                html+=projectPhaseEntryRow(p,phases.length%8);
            } else {
                html+=projectPhaseEntryRow(p,phases.length%8);
            }

            (p.tasks||[]).forEach((t,ti)=>{
                if(projectFilterMatch({...t,projectName:p.name,phaseName:''})){
                    html+=projectInlineTaskRow(p,-1,t,ti,7,'');
                }
            });
            return html;
        }

        const projectHeaderLabels=['','Project','Task','Owner','Start','Planned Completion','Actual Completion','Gain Demand/Week','Est. Annual Saving/years','Achieved Annual Saving/years','Detailed Status','Overall Status','Note'];
        const projectHeaderKeys=['no','project','task','owner','startDate','dueDate','actualDate','gainDemand','estSaving','actualSaving','detail','status','note'];
        let projectHeaderFilters={};
        const collapsedProjectPhases=new Set();

        // Expand/collapse control for the entire Project / Phase hierarchy.
        // This function must exist before renderProjectsTable() can call it.
        function updateProjectExpandCollapseButton(){
            const btn=document.getElementById('projectExpandCollapseBtn');
            if(!btn)return;
            const projects=Array.isArray(projectsList)?projectsList.filter(p=>p&&String(p.name||'').trim()):[];
            let allExpanded=false;
            if(projectCurrentView==='gantt'){
                allExpanded=projects.length>0 && projects.every(p=>!collapsedGanttProjects.has(String(p.id)) && (Array.isArray(p.phases)?p.phases:[]).every((ph,pi)=>!collapsedGanttPhases.has(ganttNodeKey(p.id,pi))));
            }else{
                allExpanded=projects.length>0 && projects.every(p=>expandedProjectRows.has(String(p.id)));
            }
            btn.title=allExpanded?'Collapse all':'Expand all';
            btn.innerHTML=allExpanded
                ? '<i class="fa-solid fa-down-left-and-up-right-to-center"></i><span>Collapse all</span>'
                : '<i class="fa-solid fa-up-right-and-down-left-from-center"></i><span>Expand all</span>';
            btn.dataset.expanded=allExpanded?'1':'0';
            btn.disabled=!projects.length;
            btn.classList.toggle('opacity-50',!projects.length);
            btn.classList.toggle('cursor-not-allowed',!projects.length);
        }

        function toggleAllProjectRows(){
            const projects=Array.isArray(projectsList)?projectsList.filter(p=>p&&String(p.name||'').trim()):[];
            if(!projects.length)return;
            if(projectCurrentView==='gantt'){
                const allExpanded=projects.every(p=>!collapsedGanttProjects.has(String(p.id)) && (Array.isArray(p.phases)?p.phases:[]).every((ph,pi)=>!collapsedGanttPhases.has(ganttNodeKey(p.id,pi))));
                if(allExpanded){
                    projects.forEach(p=>{collapsedGanttProjects.add(String(p.id));(p.phases||[]).forEach((ph,pi)=>collapsedGanttPhases.add(ganttNodeKey(p.id,pi)));});
                }else{
                    collapsedGanttProjects.clear();collapsedGanttPhases.clear();
                }
                renderGanttChart();
            }else{
                const allExpanded=projects.every(p=>expandedProjectRows.has(String(p.id)));
                if(allExpanded){
                    expandedProjectRows.clear();
                    collapsedProjectPhases.clear();
                }else{
                    projects.forEach(p=>{
                        const pid=String(p.id);
                        expandedProjectRows.add(pid);
                        (Array.isArray(p.phases)?p.phases:[]).forEach((ph,pi)=>collapsedProjectPhases.delete(projectPhaseCollapseKey(pid,pi)));
                    });
                }
                renderProjectsTable();
            }
            requestAnimationFrame(updateProjectExpandCollapseButton);
        }

        function projectPhaseCollapseKey(projectId,phaseIndex){return `${String(projectId)}::${Number(phaseIndex)}`;}
        function toggleProjectPhase(projectId,phaseIndex){
            const key=projectPhaseCollapseKey(projectId,phaseIndex);
            if(collapsedProjectPhases.has(key)) collapsedProjectPhases.delete(key); else collapsedProjectPhases.add(key);
            renderProjectsTable();
        }

        function projectHeaderFilterValue(key,item){
            if(key==='project') return item?.projectName||'';
            if(key==='task') return item?.name||'';
            if(key==='estSaving') return item?.estSaving ?? item?.saving ?? '';
            if(key==='actualSaving') return item?.actualSaving ?? '';
            return item?.[key] ?? '';
        }
        function getProjectFilterValues(key){
            const values=[];
            const add=v=>{const x=String(v??'').trim();if(x&&!values.some(y=>y.toLowerCase()===x.toLowerCase()))values.push(x);};
            const otherFilters=Object.fromEntries(Object.entries(projectHeaderFilters).filter(([k])=>k!==key));
            const matchOther=item=>Object.entries(otherFilters).every(([k,val])=>{
                if(!Array.isArray(val)||!val.length)return true;
                const a=String(projectHeaderFilterValue(k,item)).trim().toLowerCase();
                return val.some(v=>a===String(v).trim().toLowerCase());
            });
            (projectsList||[]).forEach(p=>{
                const projectItem={projectName:p.name,phaseName:'',name:p.name,owner:projectOwnerText(p),startDate:p.startDate,dueDate:p.dueDate,actualDate:p.actualDate,gainDemand:projectAggregateSummary(p).gainDemand,estSaving:projectAggregateSummary(p).saving,actualSaving:projectAggregateSummary(p).actualSaving,detail:projectIncompleteTaskDetails(p),status:calculateProjectOverallStatus(p),note:p.note};
                if(projectMatchesSearch(p) && matchOther(projectItem)){
                    if(key==='project') add(p.name);
                    else add(projectHeaderFilterValue(key,projectItem));
                }
                (p.phases||[]).forEach((ph,pi)=>{
                    const sum=projectPhaseSummary(ph,p);
                    const phaseItem={projectName:p.name,phaseName:ph.name||`Phase ${pi+1}`,name:ph.name||`Phase ${pi+1}`,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note};
                    if(matchOther(phaseItem)) add(key==='project'?p.name:projectHeaderFilterValue(key,phaseItem));
                    (ph.tasks||[]).forEach(t=>{const item={...t,projectName:p.name,phaseName:phaseItem.phaseName};if(matchOther(item)) add(key==='project'?p.name:projectHeaderFilterValue(key,item));});
                });
                (p.tasks||[]).forEach(t=>{const item={...t,projectName:p.name,phaseName:''};if(matchOther(item)) add(key==='project'?p.name:projectHeaderFilterValue(key,item));});
            });
            return values.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
        }
        function projectFilterMatch(item){
            return Object.entries(projectHeaderFilters).every(([key,val])=>{
                if(Array.isArray(val)){if(!val.length)return true;const a=String(projectHeaderFilterValue(key,item)).trim().toLowerCase();return val.some(v=>a===String(v).trim().toLowerCase());}
                if(!val)return true;const a=String(projectHeaderFilterValue(key,item)).trim().toLowerCase();return a.includes(String(val).trim().toLowerCase());
            });
        }
        function projectHeaderColumnHeader(key,label,index){
            if(key==='no') return `<th class="c-no"><div class="pm-filter-head"><span>${label}</span></div></th>`;
            const current=Array.isArray(projectHeaderFilters[key])?projectHeaderFilters[key]:projectHeaderFilters[key]?[projectHeaderFilters[key]]:[];
            const active=current.length>0; const safe=String(label).replace(/\n/g,' ');
            return `<th class="pm-filterable" data-filter-key="${key}"><div class="pm-filter-head"><span>${safe}</span><button type="button" class="pm-filter-btn ${active?'active':''}" title="Filter ${escapeHtml(safe)}" onclick="openProjectHeaderFilter(event,'${key}',${index})"><i class="fa-solid fa-filter"></i></button></div>${active?`<div class="pm-filter-summary">${escapeHtml(current.join(', '))}</div>`:''}</th>`;
        }
        function projectRefColumnHeader(){return `<thead><tr>${projectHeaderLabels.map((label,i)=>projectHeaderColumnHeader(projectHeaderKeys[i],label,i)).join('')}</tr></thead>`;}
        function openProjectHeaderFilter(event,key,index){
            event.stopPropagation(); closeProjectHeaderFilter();
            const selected=Array.isArray(projectHeaderFilters[key])?projectHeaderFilters[key]:(projectHeaderFilters[key]?[projectHeaderFilters[key]]:[]);
            const values=getProjectFilterValues(key);
            const popup=document.createElement('div'); popup.id='projectHeaderFilterPopup'; popup.className='pm-filter-popup show';
            popup.innerHTML=`<div class="pm-filter-popup-title">Filter: ${escapeHtml(projectHeaderLabels[index])}</div><input class="pm-filter-popup-search" id="projectHeaderFilterSearch" placeholder="Search values..." autocomplete="off"><div class="pm-filter-values" id="projectHeaderFilterValues">${values.length?values.map(v=>`<label class="pm-filter-value" data-value="${escapeHtml(v).toLowerCase()}"><input type="checkbox" value="${escapeHtml(v)}" ${selected.some(x=>String(x).toLowerCase()===v.toLowerCase())?'checked':''}><span>${escapeHtml(v)}</span></label>`).join(''):`<div class="pm-filter-empty">No values found</div>`}</div><div class="pm-filter-popup-actions"><button type="button" onclick="clearProjectHeaderFilter('${key}')">Clear</button><button type="button" class="apply" onclick="applyProjectHeaderFilter('${key}')">Apply</button></div>`;
            document.body.appendChild(popup);
            const r=event.currentTarget.getBoundingClientRect(); let left=Math.min(r.left,window.innerWidth-popup.offsetWidth-8),top=r.bottom+6;if(top+popup.offsetHeight>window.innerHeight-8)top=Math.max(8,r.top-popup.offsetHeight-6);popup.style.left=Math.max(8,left)+'px';popup.style.top=top+'px';
            const search=popup.querySelector('#projectHeaderFilterSearch'); search?.addEventListener('input',()=>{const q=search.value.toLowerCase();popup.querySelectorAll('.pm-filter-value').forEach(el=>el.style.display=el.dataset.value.includes(q)?'flex':'none');});
            setTimeout(()=>search?.focus(),0);
        }
        function applyProjectHeaderFilter(key){const popup=document.getElementById('projectHeaderFilterPopup');const values=popup?[...popup.querySelectorAll('.pm-filter-value input:checked')].map(x=>x.value):[];if(values.length)projectHeaderFilters[key]=values;else delete projectHeaderFilters[key];closeProjectHeaderFilter();renderProjectsTable();}
        function clearProjectHeaderFilter(key){delete projectHeaderFilters[key];closeProjectHeaderFilter();renderProjectsTable();}
        function closeProjectHeaderFilter(){document.getElementById('projectHeaderFilterPopup')?.remove();}
        document.addEventListener('click',e=>{if(!e.target.closest('#projectHeaderFilterPopup')&&!e.target.closest('.pm-filter-btn'))closeProjectHeaderFilter();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape')closeProjectHeaderFilter();});

        function renderProjectCard(p, projectIndex){
            const pid=String(p.id).replace(/'/g,"\\'");
            p.phases=normalizeProjectPhases(p.phases,p);
            p.tasks=normalizeProjectTasks(p.tasks,p);
            const phases=p.phases||[];
            const direct=p.tasks||[];
            const taskCount=phases.reduce((n,ph)=>n+(ph.tasks||[]).length,0)+direct.length;
            const phaseCount=phases.length;
            const expanded=expandedProjectRows.has(String(p.id));
            const visible=projectMatchesSearch(p);
            if(!visible) return '';
            if(Object.keys(projectHeaderFilters).length){
                const projectItem={projectName:p.name,phaseName:'',name:p.name,owner:projectOwnerText(p),startDate:p.startDate,dueDate:p.dueDate,actualDate:p.actualDate,gainDemand:p.gainDemand,estSaving:p.saving,actualSaving:p.actualSaving,detail:projectIncompleteTaskDetails(p)||p.detail,status:p.status,note:p.note};
                const anyTask=(p.tasks||[]).some(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''}));
                const anyPhase=(p.phases||[]).some((ph)=>{const sum=projectPhaseSummary(ph,p);return projectFilterMatch({projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note})});
                if(!projectFilterMatch(projectItem)&&!anyTask&&!anyPhase)return '';
            }
            const owners=projectOwnerText(p);
            const status=String(p.status||'Not Started');
            return `<section class="pm-ref-project-card" data-project-id="${escapeHtml(String(p.id))}">
                <div class="pm-ref-project-head ${expanded?'is-expanded':''}">
                    <button type="button" class="pm-ref-project-toggle" onclick="toggleProjectRowExpand('${pid}')" aria-label="Expand project">
                        <i class="fa-solid fa-chevron-down"></i>
                    </button>
                    <span class="pm-ref-project-index">${projectIndex+1}</span>
                    <div class="pm-ref-project-name-wrap">
                        <i class="fa-solid fa-diagram-project"></i>
                        ${projectRefTextInput(p.name||'','pm-ref-project-name',`updateProjectField('${pid}','name',this.value)`,'Project name')}
                        <span class="pm-ref-project-owner">${escapeHtml(owners||'')}</span>
                    </div>
                    <div class="pm-ref-project-meta">
                        <button type="button" class="pm-ref-project-action" onclick="openAddProjectModal('${pid}')" title="Edit project"><i class="fa-solid fa-pen"></i></button>
                        <button type="button" class="pm-ref-project-action danger" onclick="deleteProject('${pid}')" title="Delete project"><i class="fa-solid fa-trash"></i></button>
                        <span><b>${taskCount}</b> tasks</span><span class="pm-ref-divider">|</span><span><b>${phaseCount}</b> phases</span>
                    </div>
                </div>
                ${expanded ? `<div class="pm-ref-project-table-wrap">
                    <table class="pm-ref-project-table">
                        <colgroup>
                            <col class="w-no"><col class="w-phase"><col class="w-task"><col class="w-owner">
                            <col class="w-date"><col class="w-date"><col class="w-date"><col class="w-gain">
                            <col class="w-saving"><col class="w-saving"><col class="w-detail"><col class="w-overall"><col class="w-note">
                        </colgroup>
                        ${projectRefColumnHeader()}
                        <tbody>${renderProjectInlineRows(p,projectIndex)}</tbody>
                    </table>
                </div>` : ''}
            </section>`;
        }

        function closeProjectRowMenus(){
            document.querySelectorAll('.pm-project-row-menu').forEach(m=>{
                const projectId=m.getAttribute('data-project-menu');
                if(m.parentElement===document.body){
                    const wrap=document.querySelector(`.pm-project-name-actions-wrap .pm-project-row-menu[data-project-menu="${CSS.escape(String(projectId||''))}"]`);
                    if(wrap) wrap.parentElement.appendChild(m); else m.remove();
                }
                m.classList.remove('show','pm-floating');
                m.style.display=''; m.style.visibility=''; m.style.left=''; m.style.top=''; m.style.right='';
            });
        }
        function toggleProjectRowMenu(event,projectId){
            event.preventDefault();
            event.stopPropagation();
            const btn=event.currentTarget;
            const wrap=btn.closest('.pm-project-name-actions-wrap');
            const menu=wrap?.querySelector('.pm-project-row-menu');
            if(!menu)return;
            const wasOpen=menu.classList.contains('show') && menu.parentElement===document.body;
            closeProjectRowMenus();
            if(wasOpen)return;
            if(menu.parentElement!==document.body)document.body.appendChild(menu);
            menu.classList.add('pm-floating','show');
            menu.style.display='block';
            menu.style.visibility='hidden';
            menu.style.position='fixed';
            menu.style.zIndex='2147483647';
            const r=btn.getBoundingClientRect();
            const mw=Math.max(140,menu.offsetWidth||140), mh=menu.offsetHeight||104;
            const left=Math.min(Math.max(8,r.right-mw),window.innerWidth-mw-8);
            const top=(r.bottom+mh+8<=window.innerHeight)?(r.bottom+4):Math.max(8,r.top-mh-4);
            menu.style.left=`${left}px`;
            menu.style.top=`${top}px`;
            menu.style.right='auto';
            menu.style.visibility='visible';
        }
        document.addEventListener('click',event=>{
            if(!event.target.closest('.pm-project-name-actions-wrap')&&!event.target.closest('.pm-project-row-menu'))closeProjectRowMenus();
        });
        window.addEventListener('resize',closeProjectRowMenus);
        window.addEventListener('scroll',closeProjectRowMenus,true);

        function getVisibleProjectExportRows(){
            const rows=[]; let no=0;
            (projectsList||[]).forEach(p=>{
                if(!p||!String(p.name||'').trim()||!projectMatchesSearch(p))return;
                const totals=projectAggregateSummary(p);
                const projectItem={projectName:p.name,phaseName:'',name:p.name,owner:projectOwnerText(p),startDate:p.startDate,dueDate:p.dueDate,actualDate:p.actualDate,gainDemand:totals.gainDemand,estSaving:totals.saving,actualSaving:totals.actualSaving,detail:'',status:p.status,note:p.note};
                const anyTask=(p.tasks||[]).some(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''}));
                const anyPhase=(p.phases||[]).some(ph=>{const sum=projectPhaseSummary(ph,p);return projectFilterMatch({projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:'',status:sum.status,note:sum.note});});
                if(Object.keys(projectHeaderFilters).length && !projectFilterMatch(projectItem)&&!anyTask&&!anyPhase)return;
                no++;
                rows.push({No:no,Project:p.name||'',Phase:'',Task:'',Owner:projectOwnerText(p)||'',Start:cleanDateStr(p.startDate)||'',"Planned Completion":cleanDateStr(p.dueDate)||'',"Actual Completion":cleanDateStr(p.actualDate)||'',"Gain Demand/Week":totals.gainDemand||'',"Est. Annual Saving/years":totals.saving||'',"Achieved Annual Saving/years":totals.actualSaving||'',"Detailed Status":projectIncompleteTaskDetails(p)||'',"Overall Status":p.status||'',Note:p.note||''});
                if(!expandedProjectRows.has(String(p.id)))return;
                (p.phases||[]).forEach((ph,pi)=>{
                    const sum=projectPhaseSummary(ph,p); const phaseItem={projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:'',status:sum.status,note:sum.note};
                    const taskRows=(ph.tasks||[]).filter(t=>projectFilterMatch({...t,projectName:p.name,phaseName:ph.name}));
                    if(Object.keys(projectHeaderFilters).length&&!projectFilterMatch(phaseItem)&&!taskRows.length)return;
                    rows.push({No:'',Project:'',Phase:ph.name||`Phase ${pi+1}`,Task:'',Owner:sum.owner||'',Start:cleanDateStr(sum.startDate)||'',"Planned Completion":cleanDateStr(sum.dueDate)||'',"Actual Completion":cleanDateStr(sum.actualDate)||'',"Gain Demand/Week":sum.gainDemand||'',"Est. Annual Saving/years":sum.saving||'',"Achieved Annual Saving/years":sum.actualSaving||'',"Detailed Status":sum.detail||'',"Overall Status":sum.status||'',Note:sum.note||''});
                    if(collapsedProjectPhases.has(projectPhaseCollapseKey(p.id,pi)))return;
                    taskRows.forEach(t=>rows.push({No:'',Project:'',Phase:ph.name||`Phase ${pi+1}`,Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||''}));
                });
                (p.tasks||[]).filter(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''})).forEach(t=>rows.push({No:'',Project:p.name||'',Phase:'',Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||''}));
            });
            return rows.filter(r=>Object.values(r).some(v=>String(v??'').trim()!==''));
        }
        function openProjectExportOptions(){
            document.getElementById('projectExportOptions')?.remove();
            const m=document.createElement('div');m.id='projectExportOptions';m.className='pm-export-modal';
            m.innerHTML='<div class="pm-export-box"><div class="pm-export-title">Export Project Management</div><div class="pm-export-subtitle">Export all project, phase and task data with the current table formatting.</div><div class="pm-export-actions"><button type="button" onclick="exportProjectExcel();closeProjectExportOptions()"><i class="fa-solid fa-file-excel"></i><span>Export Excel</span></button><button type="button" onclick="exportProjectPdf();closeProjectExportOptions()"><i class="fa-solid fa-file-pdf"></i><span>Export PDF</span></button></div><button type="button" class="pm-export-close" onclick="closeProjectExportOptions()">Cancel</button></div>';
            document.body.appendChild(m);m.addEventListener('click',e=>{if(e.target===m)closeProjectExportOptions();});
        }
        function closeProjectExportOptions(){document.getElementById('projectExportOptions')?.remove();}
        function getAllProjectExportRows(){
            const rows=[]; let no=0;
            (projectsList||[]).forEach(p=>{
                if(!p||!String(p.name||'').trim())return;
                no++;
                const totals=projectAggregateSummary(p);
                const description=p.detail||'';
                rows.push({No:no,Project:p.name||'',Description:description,Phase:'',Task:'',Owner:projectOwnerText(p)||'',Start:cleanDateStr(p.startDate)||'',"Planned Completion":cleanDateStr(p.dueDate)||'',"Actual Completion":cleanDateStr(p.actualDate)||'',"Gain Demand/Week":totals.gainDemand||'',"Est. Annual Saving/years":totals.saving||'',"Achieved Annual Saving/years":totals.actualSaving||'',"Detailed Status":projectIncompleteTaskDetails(p)||p.detailedStatus||'',"Overall Status":calculateProjectOverallStatus(p)||p.status||'',Note:p.note||'',__kind:'project'});
                (p.phases||[]).forEach((ph,pi)=>{
                    const sum=projectPhaseSummary(ph,p), phaseName=ph.name||`Phase ${pi+1}`;
                    rows.push({No:'',Project:p.name||'',Description:'',Phase:phaseName,Task:'',Owner:sum.owner||'',Start:cleanDateStr(sum.startDate)||'',"Planned Completion":cleanDateStr(sum.dueDate)||'',"Actual Completion":cleanDateStr(sum.actualDate)||'',"Gain Demand/Week":sum.gainDemand||'',"Est. Annual Saving/years":sum.saving||'',"Achieved Annual Saving/years":sum.actualSaving||'',"Detailed Status":sum.detail||'',"Overall Status":sum.status||'',Note:sum.note||'',__kind:'phase'});
                    (ph.tasks||[]).forEach(t=>rows.push({No:'',Project:p.name||'',Description:'',Phase:phaseName,Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||'',__kind:'task'}));
                });
                (p.tasks||[]).forEach(t=>rows.push({No:'',Project:p.name||'',Description:'',Phase:'',Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||'',__kind:'task'}));
            });
            return rows;
        }
        function exportProjectExcel(){
            const rows=getAllProjectExportRows(); if(!rows.length){showAppNotification('No project data to export.','Export');return;}
            const cols=['No','Project','Description','Phase','Task','Owner','Detailed Status','Overall Status','Start','Planned Completion','Actual Completion','Gain Demand/Week','Est. Annual Saving/years','Achieved Annual Saving/years','Note'];
            const aoa=[cols,...rows.map(r=>cols.map(c=>r[c]??''))];
            const ws=XLSX.utils.aoa_to_sheet(aoa), wb=XLSX.utils.book_new();
            ws['!freeze']={xSplit:0,ySplit:1};
            ws['!autofilter']={ref:`A1:${XLSX.utils.encode_col(cols.length-1)}${aoa.length}`};
            ws['!cols']=[8,24,34,22,28,18,13,17,17,17,22,24,34,17,28].map(w=>({wch:w}));
            const fill={project:'DCEEFF',phase:'EEF1FB',task:'FFFFFF'};
            /* Column indexes must match the `cols` header order above (zero-based). */
            const moneyCols=new Set([12,13]); const numberCols=new Set([11]); const dateCols=new Set([8,9,10]);
            rows.forEach((r,ri)=>{
                const excelRow=ri+2;
                cols.forEach((c,ci)=>{
                    const cell=ws[XLSX.utils.encode_cell({r:excelRow-1,c:ci})]; if(!cell)return;
                    cell.s={font:{name:'Arial',sz:10,color:{rgb:'334E63'}},fill:{patternType:'solid',fgColor:{rgb:fill[r.__kind]||'FFFFFF'}},alignment:{vertical:'center',horizontal:(ci===0||numberCols.has(ci))?'right':moneyCols.has(ci)?'right':'left',wrapText:true},border:{bottom:{style:'thin',color:{rgb:'D7E1E8'}}}};
                    if(moneyCols.has(ci)){cell.t='n';cell.v=Number(r[c]||0);cell.z='$#,##0';}
                    else if(numberCols.has(ci)){cell.t='n';cell.v=Number(r[c]||0);cell.z='#,##0';}
                    else if(dateCols.has(ci)&&r[c]){cell.t='d';cell.v=new Date(r[c]+'T00:00:00');cell.z='m/d/yyyy';}
                });
            });
            const hdr=cols.map((_,ci)=>XLSX.utils.encode_cell({r:0,c:ci})); hdr.forEach(addr=>{ws[addr].s={font:{name:'Arial',sz:10,bold:true,color:{rgb:'FFFFFF'}},fill:{patternType:'solid',fgColor:{rgb:'315C7A'}},alignment:{horizontal:'center',vertical:'center',wrapText:true},border:{bottom:{style:'thin',color:{rgb:'FFFFFF'}}}};});
            XLSX.utils.book_append_sheet(wb,ws,'Project Management');
            XLSX.writeFile(wb,`Project_Management_${new Date().toISOString().slice(0,10)}.xlsx`);
        }
        function getProjectPdfRows(){
            const out=[];
            let projectNo=0;
            const add=(row,kind,color=0,level=0)=>out.push({...row,__kind:kind,__color:color,__level:level});
            (projectsList||[]).forEach(p=>{
                if(!projectMatchesSearch(p))return;
                const totals=projectAggregateSummary(p);
                const projectItem={projectName:p.name,phaseName:'',name:p.name,owner:projectOwnerText(p),startDate:p.startDate,dueDate:p.dueDate,actualDate:p.actualDate,gainDemand:totals.gainDemand,estSaving:totals.saving,actualSaving:totals.actualSaving,detail:projectIncompleteTaskDetails(p),status:p.status,note:p.note};
                const anyTask=(p.tasks||[]).some(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''}));
                const anyPhase=(p.phases||[]).some(ph=>{const sum=projectPhaseSummary(ph,p);return projectFilterMatch({projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note});});
                if(Object.keys(projectHeaderFilters).length && !projectFilterMatch(projectItem) && !anyTask && !anyPhase)return;
                const projectCompleted=String(calculateProjectOverallStatus(p)||p.status||'').toLowerCase()==='completed';
                projectNo++;
                add({No:projectNo,Project:p.name||'',Phase:'',Task:'',Owner:projectOwnerText(p)||'',Start:cleanDateStr(p.startDate)||'',"Planned Completion":cleanDateStr(p.dueDate)||'',"Actual Completion":cleanDateStr(p.actualDate)||'',"Gain Demand/Week":totals.gainDemand||'',"Est. Annual Saving/years":totals.saving||'',"Achieved Annual Saving/years":totals.actualSaving||'',"Detailed Status":projectCompleted?'Completed':projectIncompleteTaskDetails(p)||'',"Overall Status":p.status||'',Note:p.note||''},'project',0,0);
                if(projectCompleted)return;
                (p.phases||[]).forEach((ph,pi)=>{
                    const sum=projectPhaseSummary(ph,p);
                    const phaseItem={projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note};
                    const taskRows=(ph.tasks||[]).filter(t=>projectFilterMatch({...t,projectName:p.name,phaseName:ph.name}));
                    const phaseCompleted=String(sum.status||'').toLowerCase()==='completed';
                    if(phaseCompleted && !taskRows.length)return;
                    if(Object.keys(projectHeaderFilters).length&&!projectFilterMatch(phaseItem)&&!taskRows.length)return;
                    if(phaseCompleted)return;
                    add({No:'',Project:'',Phase:ph.name||`Phase ${pi+1}`,Task:'',Owner:sum.owner||'',Start:cleanDateStr(sum.startDate)||'',"Planned Completion":cleanDateStr(sum.dueDate)||'',"Actual Completion":cleanDateStr(sum.actualDate)||'',"Gain Demand/Week":sum.gainDemand||'',"Est. Annual Saving/years":sum.saving||'',"Achieved Annual Saving/years":sum.actualSaving||'',"Detailed Status":sum.detail||'',"Overall Status":sum.status||'',Note:sum.note||''},'phase',pi%8,1);
                    taskRows.forEach(t=>{
                        if(String(calculateProjectTaskStatus(t)||'').toLowerCase()==='completed')return;
                        add({No:'',Project:'',Phase:ph.name||`Phase ${pi+1}`,Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||''},'task',pi%8,2);
                    });
                });
                (p.tasks||[]).filter(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''})).forEach(t=>{
                    if(String(calculateProjectTaskStatus(t)||'').toLowerCase()==='completed')return;
                    add({No:'',Project:p.name||'',Phase:'',Task:t.name||'',Owner:t.owner||'',Start:cleanDateStr(t.startDate)||'',"Planned Completion":cleanDateStr(t.dueDate)||'',"Actual Completion":cleanDateStr(t.actualDate)||'',"Gain Demand/Week":t.gainDemand??'',"Est. Annual Saving/years":t.estSaving??'',"Achieved Annual Saving/years":t.actualSaving??'',"Detailed Status":t.detail||'',"Overall Status":calculateProjectTaskStatus(t)||'',Note:t.note||''},'task',7,1);
                });
            });
            return out.filter(r=>Object.keys(r).some(k=>!k.startsWith('__')&&String(r[k]??'').trim()!==''));
        }
        function exportProjectPdf(){
            const rows=getProjectPdfRows(); if(!rows.length){showAppNotification('No project data to export.','Export');return;}
            if(!window.jspdf?.jsPDF){showAppNotification('PDF export library is not available.','Export');return;}
            const {jsPDF}=window.jspdf;
            const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4'});
            const cols=['No','Project','Phase','Task','Owner','Detailed Status','Overall Status','Start','Planned Completion','Actual Completion','Gain Demand/Week','Est. Annual Saving/years','Achieved Annual Saving/years','Note'];
            const baseWidths=[18,70,55,72,48,44,48,48,58,62,62,82,50,89];
            const margin=18,pageW=doc.internal.pageSize.getWidth(),pageH=doc.internal.pageSize.getHeight();
            const availableW=pageW-(margin*2),baseTotal=baseWidths.reduce((a,b)=>a+b,0);
            const widths=baseWidths.map(w=>w*availableW/baseTotal);
            const tableW=availableW;
            const palette={header:'#315C7A',project:'#EEF7FC',phase:['#F2F8FC','#F4FAF5','#FFF9EE','#F9F3FC','#FFF4F7','#F2FAF9','#F5F6FC','#FAF8F0'],task:['#FBFDFF','#F9FCFA','#FFFDF9','#FDFBFF','#FFFAFC','#F9FEFD','#FAFBFF','#FFFEFA'],border:'#C7D8E4',text:'#284B63'};
            const hex=h=>{const x=h.replace('#','');return [parseInt(x.slice(0,2),16),parseInt(x.slice(2,4),16),parseInt(x.slice(4,6),16)];};
            const fill=h=>doc.setFillColor(...hex(h)), text=h=>doc.setTextColor(...hex(h));
            let y=22;
            const drawHeader=()=>{
                const h=31; fill(palette.header);doc.rect(margin,y,tableW,h,'F');doc.setDrawColor(...hex(palette.border));doc.rect(margin,y,tableW,h,'S');
                let x=margin;doc.setFont('helvetica','bold');doc.setFontSize(5.5);text('#FFFFFF');
                cols.forEach((c,i)=>{doc.line(x,y,x,y+h);const lines=doc.splitTextToSize(c,widths[i]-6).slice(0,3);doc.text(lines,x+(widths[i]/2),y+8,{maxWidth:widths[i]-6,align:'center',baseline:'top'});x+=widths[i];});doc.line(margin+tableW,y,margin+tableW,y+h);y+=h;
            };
            const drawRow=r=>{
                const h=27;if(y+h>pageH-18){doc.addPage();y=18;drawHeader();}
                const bg=r.__kind==='project'?palette.project:r.__kind==='phase'?palette.phase[r.__color%8]:palette.task[r.__color%8];fill(bg);doc.rect(margin,y,tableW,h,'F');doc.setDrawColor(...hex('#D2E0E8'));doc.rect(margin,y,tableW,h,'S');
                doc.setFont('helvetica',r.__kind==='project'?'bold':'normal');doc.setFontSize(r.__kind==='project'?5.7:5.2);text(palette.text);
                let x=margin;
                cols.forEach((c,i)=>{
                    let v=r[c]??'';
                    if(c==='Gain Demand/Week' && v!=='')v=projectNumber(v);
                    if(c==='Est. Annual Saving/years' && v!=='')v=projectMoney(v);
                    if(c==='Achieved Annual Saving/years' && v!=='')v=projectMoney(v);
                    if(['Start','Planned Completion','Actual Completion'].includes(c)&&v)v=formatDateMMDDYYYY(v);
                    if(r.__kind==='phase'&&c==='Phase')v=String(v).replace(/^Phase:\s*/i,'');
                    if(r.__kind==='task'&&c==='Task')v=String(v).replace(/^Task:\s*/i,'');
                    const align=c==='No'?'center':(c==='Gain Demand/Week'||c==='Est. Annual Saving/years'||c==='Achieved Annual Saving/years'?'right':c==='Owner'?'center':'left');
                    const lines=doc.splitTextToSize(String(v),Math.max(10,widths[i]-6)).slice(0,2);doc.text(lines,x+(align==='right'?widths[i]-3:align==='center'?widths[i]/2:3),y+(lines.length>1?8:14),{maxWidth:widths[i]-6,align,baseline:'middle'});doc.line(x,y,x,y+h);x+=widths[i];
                });
                doc.line(margin+tableW,y,margin+tableW,y+h);y+=h;
            };
            doc.setFont('helvetica','bold');doc.setFontSize(13);text('#173E6B');doc.text('Project Management',margin,y);y+=18;drawHeader();rows.forEach(drawRow);doc.save(`Project_Management_${new Date().toISOString().slice(0,10)}.pdf`);
        }
        function exportProjectManagementData(){openProjectExportOptions();}

        function renderProjectsTable(){
            const previousWrap=document.querySelector('#projectTableView .pm-shared-table-wrap');
            const previousBottom=document.getElementById('projectTableBottomScroll');
            const savedViewport={pageX:window.scrollX||window.pageXOffset||0,pageY:window.scrollY||window.pageYOffset||0,top:previousWrap?.scrollTop||0,left:previousWrap?.scrollLeft||0,bottomLeft:previousBottom?.scrollLeft||0};
            closeProjectRowMenus();
            updateProjectWorkspaceSummary();
            updateProjectExpandCollapseButton();
            const host=document.getElementById('projectsTableBody');
            if(!host)return;
            if(!projectExpandedInitialized){
                expandedProjectRows.clear();
                projectExpandedInitialized=true;
            }
            if(!projectsList.length){
                host.innerHTML=`<div class="pm-ref-empty-state"><div class="pm-ref-empty-icon"><i class="fa-solid fa-diagram-project"></i></div><b>No projects recorded</b><span>Click New Project to create a project or import a project file.</span></div>`;
                return;
            }

            let body='';
            projectsList.forEach((p,projectIndex)=>{
                p.phases=normalizeProjectPhases(p.phases,p);
                p.tasks=normalizeProjectTasks(p.tasks,p);
                syncProjectOverallStatus(p);
                if(!projectMatchesSearch(p))return;

                const projectTotals=projectAggregateSummary(p);
                const projectItem={projectName:p.name,phaseName:'',name:p.name,owner:projectOwnerText(p),startDate:p.startDate,dueDate:p.dueDate,actualDate:p.actualDate,gainDemand:projectTotals.gainDemand,estSaving:projectTotals.saving,actualSaving:projectTotals.actualSaving,detail:projectRowDetailedStatus(p),status:p.status,note:p.note};
                const anyTask=(p.tasks||[]).some(t=>projectFilterMatch({...t,projectName:p.name,phaseName:''}));
                const anyPhase=(p.phases||[]).some(ph=>{const sum=projectPhaseSummary(ph,p);return projectFilterMatch({projectName:p.name,phaseName:ph.name,name:ph.name,owner:sum.owner,startDate:sum.startDate,dueDate:sum.dueDate,actualDate:sum.actualDate,gainDemand:sum.gainDemand,estSaving:sum.saving,actualSaving:sum.actualSaving,detail:sum.detail,status:sum.status,note:sum.note});});
                if(Object.keys(projectHeaderFilters).length && !projectFilterMatch(projectItem) && !anyTask && !anyPhase)return;

                const pid=String(p.id).replace(/'/g,"\\'");
                const phases=p.phases||[];
                const taskCount=phases.reduce((n,ph)=>n+(ph.tasks||[]).length,0)+(p.tasks||[]).length;
                const phaseCount=phases.length;
                const hasSmallTasks=taskCount>0;
                const rowTotals=hasSmallTasks?projectTotals:{gainDemand:p.gainDemand,saving:p.saving,actualSaving:p.actualSaving};
                const expanded=expandedProjectRows.has(String(p.id));
                const owners=projectOwnerText(p);

                const projectDetailList=projectIncompleteTaskDetails(p);
                body+=`<tr class="pm-ref-project-row pm-ref-project-data-row ${expanded?'is-expanded':''} ${String(calculateProjectOverallStatus(p)||p.status||'').toLowerCase()==='completed'?'pm-project-completed':''}" data-project-id="${escapeHtml(String(p.id))}">
                    <td class="pm-ref-no pm-project-no-cell" onclick="toggleProjectRowExpand('${pid}')"><span class="pm-ref-project-index">${projectIndex+1}</span></td>
                    <td colspan="2" class="pm-project-name-cell"><div class="pm-project-name-actions-wrap"><div class="pm-project-name-stack"><button type="button" class="pm-project-name-button" onclick="toggleProjectRowExpand('${pid}')" title="Expand / collapse project">${escapeHtml(p.name||'Unnamed Project')}</button><div class="pm-project-inline-detail">${escapeHtml(p.detail||'')}</div></div><button type="button" class="pm-project-more-btn" onclick="toggleProjectRowMenu(event,'${pid}')" title="Project actions" aria-label="Project actions"><i class="fa-solid fa-ellipsis"></i></button><div class="pm-project-row-menu" data-project-menu="${escapeHtml(String(p.id))}"><button type="button" onclick="openAddProjectModal('${pid}');closeProjectRowMenus()"><i class="fa-solid fa-pen"></i><span>Edit</span></button><button type="button" class="danger" onclick="deleteProject('${pid}');closeProjectRowMenus()"><i class="fa-solid fa-trash"></i><span>Delete</span></button></div></div></td>
                    <td class="pm-project-owner-cell"><span>${escapeHtml(owners||'-')}</span></td>
                    <td class="pm-project-detail-cell">${projectDetailedStatusHtml(projectRowDetailedStatus(p))}</td>
                    <td>${projectOverallBadge(p.status,false,'')}</td>
                    <td>${escapeHtml(projectRefDate(p.startDate))}</td><td>${escapeHtml(projectRefDate(p.dueDate))}</td><td>${escapeHtml(projectRefDate(p.actualDate))}</td>
                    <td class="pm-ref-number">${escapeHtml(rowTotals.gainDemand===0?'0':(projectNumber(rowTotals.gainDemand)||'-'))}</td><td class="pm-ref-money">${escapeHtml(projectMoney(rowTotals.saving)||'-')}</td><td class="pm-ref-money">${escapeHtml(projectMoney(rowTotals.actualSaving)||'-')}</td>
                    <td><span>${escapeHtml(p.note||'')}</span></td>
                </tr>`;
                if(expanded){
                    body+=renderProjectInlineRows(p,projectIndex);
                }
            });

            if(!body){
                host.innerHTML=`<div class="pm-ref-empty-state"><div class="pm-ref-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div><b>No matching project</b><span>Try another project, task, or owner keyword.</span></div>`;
                return;
            }

            host.innerHTML=`<div class="pm-shared-table-wrap">
                <table class="pm-ref-project-table pm-shared-project-table">
                    <colgroup>
                        <col class="w-no"><col class="w-phase"><col class="w-task"><col class="w-owner">
                        <col class="w-detail"><col class="w-overall"><col class="w-date"><col class="w-date"><col class="w-date"><col class="w-gain">
                        <col class="w-saving"><col class="w-saving"><col class="w-note">
                    </colgroup>
                    ${projectRefColumnHeader()}
                    <tbody>${body}</tbody>
                </table>
            </div>`;
            requestAnimationFrame(()=>{
                const nextWrap=document.querySelector('#projectTableView .pm-shared-table-wrap');
                const nextBottom=document.getElementById('projectTableBottomScroll');
                if(nextWrap){nextWrap.scrollTop=savedViewport.top;nextWrap.scrollLeft=savedViewport.left;}
                if(nextBottom)nextBottom.scrollLeft=savedViewport.bottomLeft||savedViewport.left;
                window.scrollTo(savedViewport.pageX,savedViewport.pageY);
            });
        }


        function showProjectImportProgress(current=0,total=1,text='Importing project data...'){
            let overlay=document.getElementById('projectImportProgressOverlay');
            if(!overlay){
                overlay=document.createElement('div');overlay.id='projectImportProgressOverlay';overlay.className='pm-project-import-overlay';
                overlay.innerHTML=`<div class="pm-project-import-box"><div aria-label="Loading..." class="wheel-and-hamster"><div class="wheel"><div class="spoke"></div></div><div class="hamster"><div class="hamster__body"><div class="hamster__head"><div class="hamster__ear"></div><div class="hamster__eye"></div><div class="hamster__nose"></div></div><div class="hamster__limb hamster__limb--fr"></div><div class="hamster__limb hamster__limb--fl"></div><div class="hamster__limb hamster__limb--br"></div><div class="hamster__limb hamster__limb--bl"></div><div class="hamster__tail"></div></div></div></div><div style="font-size:13px;font-weight:900;color:#214d70">Import Project</div><div id="projectImportProgressText" style="font-size:10px;color:#72869a;margin-top:4px"></div><div class="pm-import-progress"><span id="projectImportProgressBar"></span></div><div id="projectImportProgressLabel" class="pm-import-progress-label">0%</div></div>`;
                document.body.appendChild(overlay);
            }
            const pct=Math.max(0,Math.min(100,Math.round(Number(current)/Math.max(1,Number(total))*100)));
            const bar=overlay.querySelector('#projectImportProgressBar'),label=overlay.querySelector('#projectImportProgressLabel'),msg=overlay.querySelector('#projectImportProgressText');
            if(bar)bar.style.width=pct+'%'; if(label)label.textContent=pct+'%'; if(msg)msg.textContent=text;
        }
        function hideProjectImportProgress(){document.getElementById('projectImportProgressOverlay')?.remove();}
                function handleProjectImport(event){
            const file=event?.target?.files?.[0];
            if(!file)return;
            showProjectImportProgress(0,1,'Reading Excel / CSV file...');
            const reader=new FileReader();
            reader.onload=async e=>{
                try{
                    const wb=XLSX.read(new Uint8Array(e.target.result),{type:'array',cellDates:true});
                    const ws=wb.Sheets[wb.SheetNames[0]];
                    const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
                    if(!rows.length){showAppNotification('Import file is empty.','Import');return;}

                    const norm=k=>String(k??'').trim().toLowerCase().replace(/[\s_\-\/().:]+/g,'');
                    const aliases={
                        project:['project','projectname','projecttitle','projectlist'],
                        phase:['phase','phasename'],
                        task:['task','taskname','tasktitle'],
                        owner:['owner','projectowner','pic'],
                        start:['start','startdate','projectstart','taskstart','phasestart'],
                        plan:['plannedcompletion','plannedcompletiondate','duedate','plan','plandate','projectplan','taskplannedcompletion','phaseplan'],
                        actual:['actualcompletion','actualcompletiondate','actual','actualdate','projectactual','taskactualcompletion'],
                        gain:['gaindemandweek','gaindemand','taskgaindemandweek'],
                        saving:['estannualsavingyears','estannualsaving','estsaving','saving','taskestsaving'],
                        actualSaving:['achievedannualsavingyears','achievedannualsaving','actualsaving','taskactualsaving'],
                        description:['description','projectdescription','projectdetail'],
                        detailedStatus:['detailedstatus','taskdetailedstatus','phasedetailedstatus'],
                        status:['overallstatus','status','taskoverallstatus','phasestatus'],
                        note:['note','notes','tasknote']
                    };
                    const find=(row,names)=>{
                        const keys=Object.keys(row);
                        const wanted=new Set(names.map(norm));
                        const hit=keys.find(k=>wanted.has(norm(k)));
                        return hit===undefined?'':row[hit];
                    };
                    const text=(v)=>String(v??'').trim();
                    const num=(v)=>projectParseMoney(v);
                    const imported=[];
                    const byProject=new Map();
                    let currentProject=null,currentPhase=null;

                    for(let idx=0;idx<rows.length;idx++){
                        const r=rows[idx];
                        if(idx===0 || idx%20===0 || idx===rows.length-1) { showProjectImportProgress(idx+1,rows.length,`Processing row ${idx+1} of ${rows.length}...`); await new Promise(resolve=>setTimeout(resolve,0)); }
                        const projectName=text(find(r,aliases.project));
                        const phaseName=text(find(r,aliases.phase));
                        const taskName=text(find(r,aliases.task));

                        // Export and import use the same flat layout; Project is repeated on every row.
                        // A row without a Phase belongs to the project-level/direct-task branch, not the prior phase.
                        if(projectName && !phaseName) currentPhase=null;
                        if(projectName){
                            currentProject=byProject.get(projectName.toLowerCase());
                            if(!currentProject){
                                currentProject={
                                    id:projectBuilderId('project'),name:projectName,
                                    owner:text(find(r,aliases.owner)),
                                    owners:text(find(r,aliases.owner)).split(',').map(x=>x.trim()).filter(Boolean),
                                    startDate:cleanDateStr(find(r,aliases.start)),
                                    dueDate:cleanDateStr(find(r,aliases.plan)),
                                    actualDate:cleanDateStr(find(r,aliases.actual)),
                                    gainDemand:projectParseMoney(find(r,aliases.gain)),
                                    saving:num(find(r,aliases.saving)),
                                    actualSaving:num(find(r,aliases.actualSaving)),
                                    detail:(!phaseName&&!taskName)?text(find(r,aliases.description)):'',
                                    detailedStatus:text(find(r,aliases.detailedStatus)),
                                    status:text(find(r,aliases.status))||'Not Started',
                                    note:text(find(r,aliases.note)),
                                    phases:[],tasks:[],hoursUsed:{}
                                };
                                byProject.set(projectName.toLowerCase(),currentProject);
                                imported.push(currentProject);
                            }else{
                                // Fill missing project-level values from any repeated project row.
                                if(!currentProject.owner)currentProject.owner=text(find(r,aliases.owner));
                                // Description is imported only from the project header row; phase/task rows are ignored.
                                if(!currentProject.detailedStatus)currentProject.detailedStatus=text(find(r,aliases.detailedStatus));
                                if(!currentProject.startDate)currentProject.startDate=cleanDateStr(find(r,aliases.start));
                                if(!currentProject.dueDate)currentProject.dueDate=cleanDateStr(find(r,aliases.plan));
                                if(!currentProject.actualDate)currentProject.actualDate=cleanDateStr(find(r,aliases.actual));
                                if((currentProject.saving===''||currentProject.saving===0) && text(find(r,aliases.saving))!=='')currentProject.saving=num(find(r,aliases.saving));
                                if((currentProject.actualSaving===''||currentProject.actualSaving===0) && text(find(r,aliases.actualSaving))!=='')currentProject.actualSaving=num(find(r,aliases.actualSaving));
                            }
                        }
                        if(!currentProject)return;

                        if(phaseName){
                            currentPhase=currentProject.phases.find(ph=>ph.name.toLowerCase()===phaseName.toLowerCase());
                            if(!currentPhase){
                                currentPhase={
                                    id:projectBuilderId('phase'),name:phaseName,startDate:'',dueDate:'',actualDate:'',
                                    tasks:[]
                                };
                                currentProject.phases.push(currentPhase);
                            }
                            // Phase-level exported values are useful even if there are no tasks yet.
                            const rowStart=cleanDateStr(find(r,aliases.start)), rowPlan=cleanDateStr(find(r,aliases.plan)), rowActual=cleanDateStr(find(r,aliases.actual));
                            if(rowStart)currentPhase.startDate=rowStart;
                            if(rowPlan)currentPhase.dueDate=rowPlan;
                            if(rowActual)currentPhase.actualDate=rowActual;
                        }

                        if(taskName){
                            const target=currentPhase;
                            const task={
                                id:projectBuilderId('task'),name:taskName,
                                owner:text(find(r,aliases.owner))||projectOwnerText(currentProject),
                                startDate:cleanDateStr(find(r,aliases.start)),
                                dueDate:cleanDateStr(find(r,aliases.plan)),
                                actualDate:cleanDateStr(find(r,aliases.actual)),
                                gainDemand:projectParseMoney(find(r,aliases.gain)),
                                estSaving:num(find(r,aliases.saving)),
                                actualSaving:num(find(r,aliases.actualSaving)),
                                detail:text(find(r,aliases.detailedStatus)),
                                status:text(find(r,aliases.status))||'Not Started',
                                note:text(find(r,aliases.note)),
                                progress:0
                            };
                            if(target)target.tasks.push(task); else currentProject.tasks.push(task);
                        }
                    }

                    if(!imported.length){hideProjectImportProgress();showAppNotification('No project rows found in the file.','Import');return;}
                    imported.forEach(p=>{
                        p.phases=normalizeProjectPhases(p.phases,p);
                        p.tasks=normalizeProjectTasks(p.tasks,p);
                        syncProjectOverallStatus(p);
                        p.hoursUsed=buildProjectStorageHours(p);
                    });

                    // Upsert by project name (case-insensitive): importing the same project updates it instead of creating a duplicate.
                    imported.forEach(incoming=>{
                        const key=String(incoming.name||'').trim().toLowerCase();
                        const existingIndex=projectsList.findIndex(existing=>String(existing.name||'').trim().toLowerCase()===key);
                        if(existingIndex>=0){
                            incoming.id=projectsList[existingIndex].id;
                            incoming.createdAt=projectsList[existingIndex].createdAt||incoming.createdAt;
                            incoming.updatedAt=new Date().toISOString();
                            projectsList[existingIndex]=incoming;
                        }else{
                            projectsList.push(incoming);
                        }
                        incoming.owner=projectOwnerText(incoming);
                        incoming.owners=Array.isArray(incoming.owners)?incoming.owners:String(incoming.owner||'').split(',').map(x=>x.trim()).filter(Boolean);
                        expandedProjectRows.add(String(incoming.id));
                    });
                    showProjectImportProgress(98,100,'Saving imported projects...');
                    const projectSaveResult=await saveSheetData('Projects',projectsList);
                    if(projectSaveResult===false) throw new Error('Supabase did not save the imported projects. Check access permissions and database policies.');
                    // Refresh project/phase/task rows from Supabase so the view reflects
                    // the persisted relational records and their database IDs.
                    if(typeof fetchAllDataFromSheet==='function'){
                        const refreshed=await fetchAllDataFromSheet({background:false});
                        if(refreshed===false) throw new Error('Projects were submitted but Supabase refresh failed. Please check the database connection and try again.');
                    }
                    showProjectImportProgress(100,100,'Import completed.');
                    renderProjectsTable();
                    renderGanttChart();
                    updateDashboardCharts();
                    showAppNotification(`Imported ${imported.length} project(s), ${imported.reduce((n,p)=>n+(p.phases||[]).reduce((m,ph)=>m+(ph.tasks||[]).length,0)+(p.tasks||[]).length,0)} task(s).`,'Import Complete');
                    await new Promise(resolve=>setTimeout(resolve,350));
                }catch(err){
                    hideProjectImportProgress();
                    console.error('Project import error:',err);
                    showAppNotification(`Unable to import project file. ${err?.message||err}`,'Import Error');
                }finally{
                    hideProjectImportProgress();
                    if(event.target)event.target.value='';
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function updateProjectWorkspaceSummary(){
            const total=projectsList.length,active=projectsList.filter(p=>!['completed','done','closed'].includes(String(p.status||'').toLowerCase())).length;
            const today=new Date();today.setHours(0,0,0,0);const due=projectsList.filter(p=>{const d=cleanDateStr(p.dueDate);if(!d)return false;const dt=new Date(d+'T00:00:00');const days=Math.round((dt-today)/86400000);return days>=0&&days<=14;}).length;
            const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};set('projectMetricTotal',total);set('projectMetricActive',active);set('projectMetricDue',due);
        }
        function updateProjectField(projectId,key,value){
            const p=projectsList.find(x=>String(x.id)===String(projectId));if(!p)return;
            if(['startDate','dueDate','actualDate'].includes(key)) value=cleanDateStr(value);
            if(['saving','actualSaving'].includes(key)) { const n=Number(value); value=value===''?'':(Number.isFinite(n)?n:0); }
            if(key==='startDate'&&p.dueDate&&value>p.dueDate)p.dueDate=value;
            if(key==='dueDate'&&p.startDate&&value<p.startDate)p.startDate=value;
            if(key==='actualDate'&&value&&(value<p.startDate||value>p.dueDate)) value='';
            p[key]=value; p.phases=normalizeProjectPhases(p.phases,p);p.tasks=normalizeProjectTasks(p.tasks,p);syncProjectOverallStatus(p);queueProjectInlineSave(projectId);renderProjectsTable();
        }
        function updateProjectOwners(projectId,value){const p=projectsList.find(x=>String(x.id)===String(projectId));if(!p)return;p.owner=value;p.owners=String(value||'').split(',').map(x=>x.trim()).filter(Boolean);queueProjectInlineSave(projectId);renderProjectsTable();}
        function updateProjectInlinePhase(projectId,phaseIndex,key,value){const p=projectsList.find(x=>String(x.id)===String(projectId));if(!p||!p.phases?.[phaseIndex])return;p.phases[phaseIndex][key]=value;queueProjectInlineSave(projectId);renderProjectsTable();}
        function getProjectInlineTaskList(project,phaseIndex){
            if(phaseIndex===-1)return Array.isArray(project.tasks)?project.tasks:(project.tasks=[]);
            if(!Array.isArray(project.phases))project.phases=[];
            if(!project.phases[phaseIndex])return [];
            if(!Array.isArray(project.phases[phaseIndex].tasks))project.phases[phaseIndex].tasks=[];
            return project.phases[phaseIndex].tasks;
        }
        function projectOwnerOptionsHtml(selected){
            const sel=String(selected||'').split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.toLowerCase());
            return users.filter(u=>String(u.name||'').trim()).map(u=>{const n=String(u.name).trim();return `<label class="pm-owner-picker-option"><input type="checkbox" value="${escapeHtml(n)}" ${sel.includes(n.toLowerCase())?'checked':''} onchange="updateProjectInlineTaskOwners(this)"><span>${escapeHtml(n)}</span></label>`;}).join('') || '<div class="pm-filter-empty">No users</div>';
        }
        let activeProjectOwnerPicker=null;
        function toggleProjectTaskOwnerPicker(event,projectId,phaseIndex,taskIndex){
            event.stopPropagation(); document.querySelectorAll('.pm-owner-picker-menu').forEach(x=>x.remove());
            const btn=event.currentTarget,menu=document.createElement('div'); menu.className='pm-owner-picker-menu'; menu.dataset.projectId=String(projectId);menu.dataset.phaseIndex=String(phaseIndex);menu.dataset.taskIndex=String(taskIndex);
            const p=projectsList.find(x=>String(x.id)===String(projectId)),t=p?getProjectInlineTaskList(p,phaseIndex)[taskIndex]:null; if(!t)return;
            menu.innerHTML=projectOwnerOptionsHtml(t.owner); document.body.appendChild(menu); const r=btn.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-210))+'px';menu.style.top=Math.min(window.innerHeight-menu.offsetHeight-8,r.bottom+4)+'px'; activeProjectOwnerPicker=menu;
        }
        function updateProjectInlineTaskOwners(input){
            const menu=input.closest('.pm-owner-picker-menu'); if(!menu)return; const vals=[...menu.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value); const p=projectsList.find(x=>String(x.id)===String(menu.dataset.projectId));if(!p)return;const t=getProjectInlineTaskList(p,Number(menu.dataset.phaseIndex))[Number(menu.dataset.taskIndex)];if(!t)return;t.owner=vals.join(', ');syncProjectOverallStatus(p);queueProjectInlineSave(p.id);const row=input.closest('tr');const btn=row?.querySelector('.pm-owner-picker-btn');if(btn)btn.textContent=vals.join(', ')||'Select Owner(s)';renderProjectsTable();setTimeout(()=>{const newBtn=document.querySelector(`[data-owner-project="${String(p.id)}"][data-owner-phase="${menu.dataset.phaseIndex}"][data-owner-task="${menu.dataset.taskIndex}"]`);if(newBtn)newBtn.click();},0);
        }
        document.addEventListener('click',e=>{if(!e.target.closest('.pm-owner-picker-menu')&&!e.target.closest('.pm-owner-picker-btn'))document.querySelectorAll('.pm-owner-picker-menu').forEach(x=>x.remove());});
        function projectTaskOwnerPicker(p,phaseIndex,taskIndex,owner){const pid=String(p.id).replace(/'/g,"\\'");return `<div class="pm-owner-picker"><button type="button" class="pm-owner-picker-btn" data-owner-project="${escapeHtml(String(p.id))}" data-owner-phase="${phaseIndex}" data-owner-task="${taskIndex}" onclick="toggleProjectTaskOwnerPicker(event,'${pid}',${phaseIndex},${taskIndex})" title="Select one or more owners">${escapeHtml(owner||'Select Owner(s)')}</button></div>`;}
        function projectTaskEntryRow(p,phaseIndex,phaseName,phaseColor){
            const pid=String(p.id).replace(/'/g,"\\'");
            return `<tr class="pm-task-entry-row phase-task-color-${phaseColor}">
                <td class="pm-ref-no"></td>
                <td class="pm-ref-phase-empty"><span class="pm-ref-tree-line"></span></td>
                <td class="pm-ref-task-cell">
                    <input class="pm-ref-input pm-ref-task-input pm-task-entry-input" placeholder="Enter task..."
                        onkeydown="if(event.key==='Enter'){event.preventDefault();createProjectInlineTaskFromEntry(this,'${pid}',${phaseIndex});}"
                        onblur="createProjectInlineTaskFromEntry(this,'${pid}',${phaseIndex});">
                    <span class="pm-ref-drag-handle" style="visibility:hidden"><i class="fa-solid fa-grip-vertical"></i></span>
                </td>
                <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
            </tr>`;
        }
        async function createProjectInlineTaskFromEntry(input,projectId,phaseIndex){
            const el=input && input.value!==undefined ? input : null;
            if(!el)return;
            const v=String(el.value||'').trim();
            if(!v || el.dataset.creating==='1')return;
            el.dataset.creating='1';
            try{
                const saved=await addProjectInlineTask(projectId,phaseIndex,v);
                if(saved && el) el.value='';
            }catch(err){ console.error('Inline task creation error:',err); }
            finally{ if(el)el.dataset.creating=''; }
        }
        function updateProjectInlineTask(projectId,phaseIndex,taskIndex,key,value){
            const p=projectsList.find(x=>String(x.id)===String(projectId));if(!p)return;const list=getProjectInlineTaskList(p,phaseIndex),t=list[taskIndex];if(!t)return;if(key==='status')return;if(['startDate','dueDate','actualDate'].includes(key))value=cleanDateStr(value);if(['estSaving','actualSaving'].includes(key)){ const n=projectParseMoney(value); value=String(value??'').trim()===''?'':(n!==''&&Number.isFinite(Number(n))?Number(n):0); }
            if(key==='dueDate' && t.startDate && value && value<=t.startDate){showToast('Planned Completion must be later than Start');renderProjectsTable();return;}
            t[key]=value;if(key==='startDate'){if(t.dueDate&&t.dueDate<=value)t.dueDate=projectNextDate(value);if(t.actualDate&&t.actualDate<value)t.actualDate=value;}
            if(key==='actualDate'&&t.dueDate&&value>t.dueDate)t.dueDate=value>t.dueDate?value:t.dueDate;
            t.status=calculateProjectTaskStatus(t);syncProjectOverallStatus(p);queueProjectInlineSave(projectId);renderProjectsTable();
        }
        async function addProjectInlinePhase(projectId,name){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p)return false;
            const phases=normalizeProjectPhases(p.phases,p);
            const phaseName=String(name||'').trim()||`Phase ${phases.length+1}`;
            const newIndex=phases.length;
            phases.push({id:projectBuilderId('phase'),name:phaseName,startDate:'',dueDate:'',actualDate:'',tasks:[]});
            p.phases=phases;
            expandedProjectRows.add(String(projectId));
            collapsedProjectPhases.delete(projectPhaseCollapseKey(projectId,newIndex));
            syncProjectOverallStatus(p);
            renderProjectsTable();
            renderGanttChart();
            try{
                await saveSheetData('Projects',projectsList);
                renderProjectsTable();
                renderGanttChart();
                return true;
            }catch(e){
                console.error(e);
                renderProjectsTable();
                showToast('Unable to save new phase');
                return false;
            }
        }
        async function addProjectInlineTask(projectId,phaseIndex,name){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p)return false;
            const list=getProjectInlineTaskList(p,phaseIndex);
            const taskName=String(name||'').trim();
            if(!taskName)return false;
            list.push({
                id:projectBuilderId('task'),name:taskName,owner:projectOwnerText(p),
                startDate:'',
                dueDate:'',
                actualDate:'',detail:'',gainDemand:'',estSaving:'',actualSaving:'',note:'',
                progress:0,status:'Not Started'
            });
            expandedProjectRows.add(String(projectId));
            if(phaseIndex>=0)collapsedProjectPhases.delete(projectPhaseCollapseKey(projectId,phaseIndex));
            syncProjectOverallStatus(p);

            // Render immediately: the phase always keeps exactly one fresh blank entry row.
            renderProjectsTable();
            renderGanttChart();
            try{
                await saveSheetData('Projects',projectsList);
                renderProjectsTable();
                renderGanttChart();
                return true;
            }catch(e){
                console.error(e);
                // Keep the newly entered row in the local model even when cloud save fails.
                renderProjectsTable();
                showToast('Unable to save new task');
                return false;
            }
        }
        async function deleteProjectInlinePhase(projectId,phaseIndex){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p || !p.phases?.[phaseIndex]) return;
            const phaseName=String(p.phases[phaseIndex].name||`Phase ${phaseIndex+1}`);
            if(!(await showAppConfirm(`Delete ${phaseName} and all tasks in this phase? This cannot be undone.`, 'Delete Phase'))) return;
            p.phases.splice(phaseIndex,1);
            // The remaining phase entry row is generated automatically from p.phases.length.
            collapsedProjectPhases.forEach(key=>{ if(key.startsWith(`${String(projectId)}::`)) collapsedProjectPhases.delete(key); });
            syncProjectOverallStatus(p);
            renderProjectsTable();
            renderGanttChart();
            try{ await saveSheetData('Projects',projectsList); }catch(e){ console.error(e); showToast('Unable to delete phase'); }
        }
        async function deleteProjectInlineTask(projectId,phaseIndex,taskIndex){
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p) return;
            const list=getProjectInlineTaskList(p,phaseIndex);
            if(!list[taskIndex]) return;
            const taskName=String(list[taskIndex].name||`Task ${taskIndex+1}`);
            if(!(await showAppConfirm(`Delete task "${taskName}"? This cannot be undone.`, 'Delete Task'))) return;
            list.splice(taskIndex,1);
            syncProjectOverallStatus(p);
            renderProjectsTable();
            renderGanttChart();
            try{ await saveSheetData('Projects',projectsList); }catch(e){ console.error(e); showToast('Unable to delete task'); }
        }
        function projectTaskDragStart(event,phaseIndex,taskIndex,projectId){
            if(!event?.currentTarget?.classList?.contains('pm-ref-drag-handle')){
                event?.preventDefault?.();
                return;
            }
            projectDragState={projectId:String(projectId),phaseIndex,taskIndex};
            if(event.dataTransfer){
                event.dataTransfer.effectAllowed='move';
                event.dataTransfer.setData('text/plain',JSON.stringify({projectId:String(projectId),phaseIndex,taskIndex}));
            }
            event.currentTarget.classList.add('pm-dragging');
        }
        function projectTaskDragOver(event){
            event.preventDefault();
            if(event.dataTransfer) event.dataTransfer.dropEffect='move';
            document.querySelectorAll('.pm-drag-over').forEach(e=>{if(e!==event.currentTarget)e.classList.remove('pm-drag-over');});
            event.currentTarget.classList.add('pm-drag-over');
        }
        function projectTaskDragEnd(){
            document.querySelectorAll('.pm-dragging,.pm-drag-over').forEach(e=>e.classList.remove('pm-dragging','pm-drag-over'));
            projectDragState=null;
        }
        async function projectTaskDrop(event,targetPhaseIndex,targetTaskIndex,projectId){
            event.preventDefault();
            if(!projectDragState||String(projectDragState.projectId)!==String(projectId)){projectTaskDragEnd();return;}
            const p=projectsList.find(x=>String(x.id)===String(projectId));
            if(!p){projectTaskDragEnd();return;}
            // Resolve both lists from the same in-memory project arrays. Re-normalizing between src/dst would create two different array references and duplicate the moved task.
            if(!Array.isArray(p.phases))p.phases=[];
            if(projectDragState.phaseIndex>=0 && !Array.isArray(p.phases[projectDragState.phaseIndex]?.tasks))p.phases[projectDragState.phaseIndex].tasks=[];
            if(targetPhaseIndex>=0 && !Array.isArray(p.phases[targetPhaseIndex]?.tasks))p.phases[targetPhaseIndex].tasks=[];
            if(projectDragState.phaseIndex===-1 && !Array.isArray(p.tasks))p.tasks=[];
            if(targetPhaseIndex===-1 && !Array.isArray(p.tasks))p.tasks=[];
            const src=getProjectInlineTaskList(p,projectDragState.phaseIndex);
            const dst=getProjectInlineTaskList(p,targetPhaseIndex);
            const sourceIndex=projectDragState.taskIndex;
            if(!src[sourceIndex]){projectTaskDragEnd();return;}
            const [moved]=src.splice(sourceIndex,1);
            let at=Number(targetTaskIndex);
            if(src===dst && sourceIndex<at) at--;
            at=Math.max(0,Math.min(at,dst.length));
            dst.splice(at,0,moved);
            syncProjectOverallStatus(p);
            projectTaskDragEnd();
            try{
                p.hoursUsed=buildProjectStorageHours(p);
                await saveSheetData('Projects',projectsList);
                renderProjectsTable();
                renderGanttChart();
                updateDashboardCharts();
            }catch(err){
                console.error('Project task reorder error:',err);
                showAppNotification(`Unable to save task order. ${err?.message||err||'Unknown error'}`,'Save Error');
                renderProjectsTable();
            }
        }
        function addProjectQuickPhase(){if(!projectsList.length){openAddProjectModal();return;}const p=projectsList.find(x=>expandedProjectRows.has(String(x.id)))||projectsList[0];addProjectInlinePhase(p.id,'');}
        function addProjectQuickTask(){if(!projectsList.length){openAddProjectModal();return;}const p=projectsList.find(x=>expandedProjectRows.has(String(x.id)))||projectsList[0];expandedProjectRows.add(String(p.id));addProjectInlineTask(p.id,p.phases?.length?p.phases.length-1:-1,'');}
        function queueProjectInlineSave(projectId){const key=String(projectId);clearTimeout(projectInlineSaveTimers.get(key));projectInlineSaveTimers.set(key,setTimeout(async()=>{const p=projectsList.find(x=>String(x.id)===key);if(!p)return;p.hoursUsed=buildProjectStorageHours(p);try{await saveSheetData('Projects',projectsList);renderGanttChart();updateDashboardCharts();}catch(e){console.error(e);showToast('Unable to save project change');}},300));}
        let projectBuilderPhases=[];
        let projectCurrentView='table';
        let projectGanttAnchor=new Date();
        let activeScheduleProjectId=null;
        function setProjectView(view,skipRender=false){
            projectCurrentView=view==='gantt'?'gantt':'table';
            updateProjectExpandCollapseButton();
            const table=document.getElementById('projectTableView'),gantt=document.getElementById('projectGanttView'),bt=document.getElementById('projectViewTableBtn'),bg=document.getElementById('projectViewGanttBtn');
            if(bt)bt.classList.toggle('active',projectCurrentView==='table');
            if(bg)bg.classList.toggle('active',projectCurrentView==='gantt');
            if(table)table.classList.toggle('hidden',projectCurrentView!=='table');
            if(gantt)gantt.classList.toggle('hidden',projectCurrentView!=='gantt');
            if(projectCurrentView==='gantt') renderGanttChart(); else syncProjectBottomScroll();
        }
        function syncProjectBottomScroll(){
            const view=document.getElementById('projectTableView');
            const wrap=view?.querySelector('.pm-shared-table-wrap');
            const bar=document.getElementById('projectTableBottomScroll');
            const inner=bar?.firstElementChild;
            const table=view?.querySelector('.pm-shared-project-table');
            if(!view||!wrap||!bar||!inner)return;
            const width=Math.max(table?.scrollWidth||0,wrap.scrollWidth,wrap.clientWidth);
            inner.style.width=width+'px';
            if(!bar._bound){
                bar._bound=true;
                bar.addEventListener('scroll',()=>{wrap.scrollLeft=bar.scrollLeft;});
                wrap.addEventListener('scroll',()=>{if(Math.abs(bar.scrollLeft-wrap.scrollLeft)>1)bar.scrollLeft=wrap.scrollLeft;});
                window.addEventListener('resize',syncProjectBottomScroll);
            }
            requestAnimationFrame(()=>{
                inner.style.width=Math.max(table?.scrollWidth||0,wrap.scrollWidth,wrap.clientWidth)+'px';
                bar.scrollLeft=wrap.scrollLeft;
            });
        }
        function getProjectGanttRange(){const dates=[];projectsList.forEach(p=>{if(p.startDate)dates.push(new Date(p.startDate+'T00:00:00'));if(p.dueDate)dates.push(new Date(p.dueDate+'T00:00:00'));(p.phases||[]).forEach(ph=>{if(ph.startDate)dates.push(new Date(ph.startDate+'T00:00:00'));if(ph.dueDate)dates.push(new Date(ph.dueDate+'T00:00:00'));(ph.tasks||[]).forEach(t=>{if(t.startDate)dates.push(new Date(t.startDate+'T00:00:00'));if(t.dueDate)dates.push(new Date(t.dueDate+'T00:00:00'));});});});const anchor=new Date(projectGanttAnchor);anchor.setHours(0,0,0,0);let start=weekStart(anchor),end=addDays(start,41);if(dates.length&&!projectGanttAnchor){start=weekStart(new Date(Math.min(...dates.map(d=>d.getTime()))));end=addDays(start,41);}return {start,end};}
        function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x;}
        function weekStart(d){const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;}
        function dateToPct(date,start,end){const total=Math.max(1,end-start),x=Math.max(0,Math.min(total,new Date(date+'T00:00:00')-start));return x/total*100;}
        function ganttWeeks(start,count){return Array.from({length:count},(_,i)=>addDays(start,i*7));}
        const collapsedGanttProjects=new Set();
        const collapsedGanttPhases=new Set();
        function ganttNodeKey(projectId,phaseIndex=-1){return `${String(projectId)}::${Number(phaseIndex)}`;}
        function toggleGanttProject(projectId){
            const k=String(projectId);
            if(collapsedGanttProjects.has(k))collapsedGanttProjects.delete(k);else collapsedGanttProjects.add(k);
            renderGanttChart();
        }
        function toggleGanttPhase(projectId,phaseIndex){
            const k=ganttNodeKey(projectId,phaseIndex);
            if(collapsedGanttPhases.has(k))collapsedGanttPhases.delete(k);else collapsedGanttPhases.add(k);
            renderGanttChart();
        }
        function ganttProjectMatchesFilters(p){
            if(!p) return false;
            if(projectTableSearchText && !projectMatchesSearch(p)) return false;
            const selectedProject=ganttFilterState.Project instanceof Set?ganttFilterState.Project:new Set();
            if(selectedProject.size && !selectedProject.has(String(p.name||''))) return false;
            return true;
        }
        function ganttRowMatchesFilters(type,obj,p){
            if(!ganttProjectMatchesFilters(p)) return false;
            const ownerSet=ganttFilterState.Owner instanceof Set?ganttFilterState.Owner:new Set();
            const statusSet=ganttFilterState.Status instanceof Set?ganttFilterState.Status:new Set();
            const owner=String(obj?.owner||'').trim();
            const status=String(type==='project'?calculateProjectOverallStatus(p):type==='phase'?projectPhaseSummary(obj,p).status:calculateProjectTaskStatus(obj)||obj?.status||'Not Started').trim();
            if(ownerSet.size && !ownerSet.has(owner)) return false;
            if(statusSet.size && !statusSet.has(status)) return false;
            return true;
        }
        function ganttFilterHeader(label,key){
            const selected=ganttFilterState[key] instanceof Set?ganttFilterState[key]:new Set();
            const active=selected.size>0;
            return `<div class="gantt-filter-head"><span>${escapeHtml(label)}</span><button type="button" class="gantt-filter-btn ${active?'active':''}" onclick="toggleGanttHeaderFilter(event,'${key}')" title="Filter ${escapeHtml(label)}"><i class="fa-solid fa-filter"></i></button></div>`;
        }
        function toggleGanttHeaderFilter(event,key){
            event.stopPropagation();
            closeGanttInlineFilter();
            const btn=event.currentTarget;
            const menu=document.createElement('div');
            menu.className='gantt-inline-filter-menu';
            menu.id='ganttInlineFilterMenu';
            const values=getGanttFilterUniverse(key);
            const selected=ganttFilterState[key] instanceof Set?ganttFilterState[key]:new Set();
            ganttFilterDraftState[key]=new Set(selected);
            menu.innerHTML=`<div class="gantt-inline-filter-title">Filter: ${escapeHtml(key)}</div><input type="search" placeholder="Search values..." oninput="filterGanttInlineOptions(this)"><div class="gantt-inline-filter-values">${values.map(v=>`<label class="gantt-inline-filter-option" data-label="${escapeHtml(String(v).toLowerCase())}"><input type="checkbox" value="${escapeHtml(String(v))}" ${selected.has(String(v))?'checked':''} onchange="changeGanttHeaderFilter('${key}',this)"><span>${escapeHtml(String(v))}</span></label>`).join('')}</div><div class="gantt-inline-filter-actions"><button type="button" onclick="clearGanttHeaderFilter('${key}')">Clear</button><button type="button" class="gantt-filter-apply" onclick="applyGanttHeaderFilter('${key}')">Apply</button></div>`;
            document.body.appendChild(menu);
            const r=btn.getBoundingClientRect();
            menu.style.left=Math.max(8,Math.min(r.left,window.innerWidth-278))+'px';
            menu.style.top=Math.min(window.innerHeight-menu.offsetHeight-8,r.bottom+4)+'px';
            setTimeout(()=>menu.querySelector('input[type="search"]')?.focus(),0);
        }
        function filterGanttInlineOptions(input){
            const q=String(input.value||'').toLowerCase();
            input.closest('.gantt-inline-filter-menu')?.querySelectorAll('.gantt-inline-filter-option').forEach(el=>el.style.display=el.dataset.label.includes(q)?'flex':'none');
        }
        function changeGanttHeaderFilter(key,cb){
            if(!(ganttFilterDraftState[key] instanceof Set)) ganttFilterDraftState[key]=new Set(ganttFilterState[key]||[]);
            if(cb.checked) ganttFilterDraftState[key].add(cb.value); else ganttFilterDraftState[key].delete(cb.value);
            // Do not close or apply while the user is still selecting values.
        }
        function applyGanttHeaderFilter(key){
            if(!(ganttFilterState[key] instanceof Set)) ganttFilterState[key]=new Set();
            ganttFilterState[key].clear();
            (ganttFilterDraftState[key]||new Set()).forEach(v=>ganttFilterState[key].add(String(v)));
            closeGanttInlineFilter();
            renderGanttChart();
        }
        function clearGanttHeaderFilter(key){
            ganttFilterState[key]=new Set();
            ganttFilterDraftState[key]=new Set();
            closeGanttInlineFilter();
            renderGanttChart();
        }
        function closeGanttInlineFilter(){
            document.getElementById('ganttInlineFilterMenu')?.remove();
        }
        document.addEventListener('click',e=>{
            const menu=document.getElementById('ganttInlineFilterMenu');
            if(menu && !e.target.closest('#ganttInlineFilterMenu') && !e.target.closest('.gantt-filter-btn')) closeGanttInlineFilter();
        });
        document.addEventListener('keydown',e=>{if(e.key==='Escape') closeGanttInlineFilter();});

        function ganttBarStatus(type,item,status){
            const s=String(status||'').trim().toLowerCase();
            const today=formatDateLocal(new Date());
            const due=cleanDateStr(item?.dueDate || item?.plan || item?.plannedCompletion);
            if(s==='completed' || /complete|done/.test(s)) return 'completed';
            if(due && due < today) return 'overdue';
            if(due){
                const diff=Math.round((new Date(due+'T00:00:00')-new Date(today+'T00:00:00'))/86400000);
                if(diff>=0 && diff<=2) return 'near-deadline';
            }
            if(/working|in progress|progress|process/.test(s)) return 'working';
            return type==='project' ? 'project-default' : 'default';
        }

        function renderGanttChart(){
            const container=document.getElementById('ganttChartContainer');
            if(!container)return;
            container.innerHTML='';
            const items=(projectsList||[]).filter(p=>p&&String(p.name||'').trim());
            if(!items.length){container.innerHTML='<div class="empty-schedule">No projects recorded. Create a project first.</div>';return;}

            /* Timeline is intentionally based ONLY on dates that actually exist in
               Start / Planned / Actual fields. No filler days or months are rendered. */
            const observedSet=new Set();
            const pushDate=v=>{const d=cleanDateStr(v);if(d)observedSet.add(d);};
            items.forEach(p=>{
                normalizeProjectPhases(p.phases,p); normalizeProjectTasks(p.tasks,p);
                [p.startDate,p.dueDate,p.actualDate].forEach(pushDate);
                (p.phases||[]).forEach(ph=>{
                    [ph.startDate,ph.dueDate,ph.actualDate].forEach(pushDate);
                    (ph.tasks||[]).forEach(t=>[t.startDate,t.dueDate,t.actualDate].forEach(pushDate));
                });
                (p.tasks||[]).forEach(t=>[t.startDate,t.dueDate,t.actualDate].forEach(pushDate));
            });
            const allDates=[...observedSet].sort();
            if(!allDates.length) allDates.push(formatDateLocal(new Date()));

            const dayMs=86400000;
            const dateMs=d=>new Date(d+'T00:00:00').getTime();
            const firstMs=dateMs(allDates[0]);
            const lastMs=dateMs(allDates[allDates.length-1]);
            const totalDays=Math.max(1,Math.round((lastMs-firstMs)/dayMs)+1);

            /* Horizontal Timeline: use a real fixed-width date grid.  The previous
               renderer calculated every date from the viewport width, which made the
               table exactly fit the screen and therefore made horizontal scrolling
               impossible. */
            const projectWidth=260;
            const ownerWidth=130;
            const statusWidth=130;
            const dayWidth=44;
            const timelineWidth=Math.max(dayWidth,totalDays*dayWidth);
            const totalGanttWidth=projectWidth+ownerWidth+statusWidth+timelineWidth;
            const pos=d=>{
                const v=cleanDateStr(d); if(!v)return null;
                return Math.max(0,Math.min(timelineWidth,(dateMs(v)-firstMs)/dayMs*dayWidth));
            };
            const cellWidths=allDates.map((d,i)=>{
                if(i===allDates.length-1)return Math.max(1,timelineWidth-((dateMs(d)-firstMs)/dayMs*dayWidth));
                return Math.max(1,(dateMs(allDates[i+1])-dateMs(d))/dayMs*dayWidth);
            });
            const rangeLabel=document.getElementById('projectGanttRangeLabel'); if(rangeLabel)rangeLabel.textContent='';

            const monthGroups=[];
            allDates.forEach((d,i)=>{
                const dt=new Date(d+'T00:00:00');
                const key=`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
                const last=monthGroups[monthGroups.length-1];
                if(last&&last.key===key) last.count++;
                else monthGroups.push({key,count:1,label:dt.toLocaleDateString('en-US',{month:'short'})});
            });
            const monthHeaders=monthGroups.map(m=>`<th class="gantt-month-head" colspan="${m.count}">${m.label}</th>`).join('');
            const dateHeaders=allDates.map(d=>`<th class="gantt-date-head" data-date="${d}">${new Date(d+'T00:00:00').getDate()}</th>`).join('');
            const today=formatDateLocal(new Date());
            const todayPos=pos(today);

            const table=document.createElement('table');
            table.className='project-gantt pm-gantt-task-date-table';
            table.style.width=totalGanttWidth+'px';
            table.style.minWidth=totalGanttWidth+'px';
            table.style.maxWidth='none';
            table.style.tableLayout='fixed';
            table.style.setProperty('--gantt-day-width',dayWidth+'px');
            table.innerHTML=`<colgroup><col class="gantt-project-col" style="width:${projectWidth}px"><col class="gantt-owner-col" style="width:${ownerWidth}px"><col class="gantt-status-col" style="width:${statusWidth}px">${cellWidths.map(w=>`<col class="gantt-day-col" style="width:${w}px;min-width:${w}px;max-width:${w}px">`).join('')}</colgroup><thead><tr><th class="label-head label-col" rowspan="2">${ganttFilterHeader('Project','Project')}</th><th class="label-head owner-head" rowspan="2">${ganttFilterHeader('Owner','Owner')}</th><th class="label-head status-head" rowspan="2">${ganttFilterHeader('Status','Status')}</th>${monthHeaders}</tr><tr>${dateHeaders}</tr></thead><tbody></tbody>`;
            const tbody=table.querySelector('tbody');

            const addTodayLine=()=>{
                if(todayPos==null)return;
                const line=document.createElement('div');
                line.className='project-gantt-today-line';
                line.style.left=`${projectWidth+ownerWidth+statusWidth+todayPos}px`;
                line.style.top='0px';
                line.style.height=table.offsetHeight+'px';
                line.title='Today';
                table.style.position='relative';
                table.appendChild(line);
            };

            const addRow=(type,label,s,e,detail,owner,toggleHtml='',status='Not Started',obj=null,p=null)=>{
                if(!ganttRowMatchesFilters(type,obj||{},p||{}))return;
                const tr=document.createElement('tr'); tr.className=`${type}-row`;
                const statusText=String(status||'Not Started');
                tr.innerHTML=`<td class="label-cell label-col ${type}-label-cell"><div class="gantt-name-wrap ${type}">${toggleHtml}<span class="gantt-row-title">${escapeHtml(label||'')}</span></div></td><td class="gantt-owner-cell">${escapeHtml(owner||'-')}</td><td class="gantt-status-cell">${escapeHtml(statusText)}</td><td colspan="${allDates.length}" class="timeline-span"><div class="gantt-row-track" style="width:${timelineWidth}px;min-width:${timelineWidth}px;--timeline-width:${timelineWidth}px;--pm-grid-day-width:${dayWidth}px"></div></td>`;
                const track=tr.querySelector('.gantt-row-track');
                /* Stable two-dimensional timeline grid: vertical dotted lines use
                   the exact date-column boundaries, while the track border marks
                   the task-row separator. Bars use the same pixel coordinate system. */
                let gridX=0;
                cellWidths.forEach((w,i)=>{
                    gridX+=Number(w)||0;
                    if(i<cellWidths.length-1){
                        const line=document.createElement('span');
                        line.className='gantt-grid-vline';
                        line.style.left=`${Math.max(0,gridX-0.5)}px`;
                        track.appendChild(line);
                    }
                });
                const sd=cleanDateStr(s),pd=cleanDateStr(e),ad=cleanDateStr(obj?.actualDate);
                if(sd&&pd&&sd<=pd){
                    const left=pos(sd);
                    const planRightRaw=pos(pd);
                    const right=Math.min(timelineWidth,(planRightRaw==null?left:planRightRaw+dayWidth));
                    if(left!=null&&right>left){
                        const light=document.createElement('div');
                        light.className=`gantt-bar gantt-bar-light ${type==='project'?'project-bar':type==='task'?'task-bar':'phase-bar'}`;
                        light.dataset.startDate=sd; light.dataset.endDate=pd; light.dataset.actualDate=ad||'';
                        light.style.left=`${left}px`; light.style.width=`${Math.max(2,right-left)}px`;
                        const actualEnd=ad||today;
                        const actualPos=pos(actualEnd);
                        if(actualPos!=null){
                            const darkRight=Math.min(right,Math.max(left,actualPos+dayWidth));
                            if(darkRight>left){
                                const dark=document.createElement('div');
                                const statusClass=ganttBarStatus(type,{dueDate:pd},status);
                                dark.className=`gantt-bar gantt-bar-dark gantt-status-${statusClass}`;
                                dark.dataset.startDate=sd; dark.dataset.endDate=pd; dark.dataset.actualDate=ad||'';
                                dark.style.left=`${left}px`; dark.style.width=`${Math.max(2,darkRight-left)}px`;
                                const detailText=String(detail||'').trim();
                                dark.innerHTML=`<span class="gantt-task-bar-text">${escapeHtml(detailText)}</span>`;
                                dark.title=`${label}\nStart: ${formatDateMMDDYYYY(sd)}\nPlan: ${formatDateMMDDYYYY(pd)}\nActual: ${ad?formatDateMMDDYYYY(ad):'Today'}${detailText?'\nDetailed Status: '+detailText:''}`;
                                track.appendChild(light); track.appendChild(dark);
                            }else track.appendChild(light);
                        }else track.appendChild(light);
                    }
                }
                tbody.appendChild(tr);
            };

            items.forEach(p=>{
                if(!ganttProjectMatchesFilters(p))return;
                const pid=String(p.id).replace(/'/g,"\\'");
                const pCollapsed=collapsedGanttProjects.has(String(p.id));
                const pStatus=calculateProjectOverallStatus(p);
                addRow('project',p.name,p.startDate,p.dueDate,projectIncompleteTaskDetails(p),projectOwnerText(p),`<button type="button" class="pm-gantt-toggle" onclick="toggleGanttProject('${pid}')" title="${pCollapsed?'Expand':'Collapse'} project"><i class="fa-solid ${pCollapsed?'fa-chevron-right':'fa-chevron-down'}"></i></button>`,pStatus,p,p);
                if(pCollapsed)return;
                (p.phases||[]).forEach((ph,pi)=>{
                    const key=ganttNodeKey(p.id,pi),phCollapsed=collapsedGanttPhases.has(key),tasks=ph.tasks||[],sum=projectPhaseSummary(ph,p);
                    addRow('phase',ph.name||`Phase ${pi+1}`,sum.startDate,sum.dueDate,sum.detail||'',sum.owner||'-',`<button type="button" class="pm-gantt-toggle" onclick="toggleGanttPhase('${pid}',${pi})" title="${phCollapsed?'Expand':'Collapse'} phase"><i class="fa-solid ${phCollapsed?'fa-chevron-right':'fa-chevron-down'}"></i></button>`,sum.status||'Not Started',ph,p);
                    if(phCollapsed)return;
                    tasks.forEach(t=>addRow('task',t.name,t.startDate,t.dueDate,t.detail,t.owner||'-','',calculateProjectTaskStatus(t),t,p));
                });
                (p.tasks||[]).forEach(t=>addRow('task',t.name,t.startDate,t.dueDate,t.detail,t.owner||'-','',calculateProjectTaskStatus(t),t,p));
            });
            addTodayLine();
            const wrap=document.createElement('div');
            wrap.className='project-gantt-wrap';
            wrap.style.width=totalGanttWidth+'px';
            wrap.style.minWidth=totalGanttWidth+'px';
            wrap.style.maxWidth='none';
            wrap.style.paddingTop='0';
            wrap.appendChild(table);
            container.appendChild(wrap);
        }
        function resetProjectGanttToToday(){projectGanttAnchor=new Date();renderGanttChart();}
        function changeProjectGanttPeriod(dir){renderGanttChart();}

        function openAddProjectModal(existingProjectId = null) {
            renderPICCheckboxLists();
            const startEl=document.getElementById('projectStartDate'),dueEl=document.getElementById('projectDueDate');
            if(startEl && dueEl){startEl.onchange=()=>{dueEl.min=projectNextDate(startEl.value);if(dueEl.value&&dueEl.value<=startEl.value)dueEl.value=projectNextDate(startEl.value);};}
            if(dueEl&&startEl)dueEl.min=projectNextDate(startEl.value);
            const title=document.getElementById('projectModalTitle');
            if (existingProjectId) {
                const p=projectsList.find(pr=>pr.id==existingProjectId);
                if(p){
                    if(title)title.textContent='Edit Project';
                    document.getElementById('projectId').value=p.id;
                    document.getElementById('projectName').value=p.name||'';
                    document.getElementById('projectDetail').value=p.detail||'';
                    document.getElementById('projectStartDate').value=cleanDateStr(p.startDate);
                    document.getElementById('projectDueDate').value=cleanDateStr(p.dueDate);
                    document.getElementById('projectActualDate').value=cleanDateStr(p.actualDate);
                    document.getElementById('projectGainDemand').value=p.gainDemand??'';
                    document.getElementById('projectDetailedStatus').value=p.detailedStatus||'';
                    document.getElementById('projectSaving').value=p.saving||'';
                    document.getElementById('projectActualSaving').value=p.actualSaving||'';
                    document.getElementById('projectNote').value=p.note||'';
                    const submitBtn=document.querySelector('#projectForm button[type="submit"]');if(submitBtn)submitBtn.innerHTML='<i class="fa-solid fa-check mr-1"></i> Update';
                    const ownersArr=Array.isArray(p.owners)?p.owners:(p.owner?[p.owner]:[]);
                    document.querySelectorAll('.project-pic-checkbox').forEach(cb=>cb.checked=ownersArr.includes(cb.value));
                }
            }else{
                if(title)title.textContent='Create Project';
                document.getElementById('projectForm').reset();document.getElementById('projectId').value='';
                const submitBtn=document.querySelector('#projectForm button[type="submit"]');if(submitBtn)submitBtn.innerHTML='<i class="fa-solid fa-floppy-disk mr-1"></i> Save Project';
                document.querySelectorAll('.project-pic-checkbox').forEach(cb=>cb.checked=currentUser&&cb.value===currentUser.name);
            }
            document.getElementById('projectModal').classList.remove('opacity-0','pointer-events-none');document.body.classList.add('modal-active');
        }
        function closeProjectModal(){document.getElementById('projectModal').classList.add('opacity-0','pointer-events-none');document.body.classList.remove('modal-active');}
        async function saveProject(e){
            e.preventDefault();
            const id=document.getElementById('projectId').value;
            const owners=Array.from(document.querySelectorAll('.project-pic-checkbox')).filter(cb=>cb.checked).map(cb=>cb.value);
            const projectName=document.getElementById('projectName').value.trim();
            const projectStartDate=cleanDateStr(document.getElementById('projectStartDate').value),projectDueDate=cleanDateStr(document.getElementById('projectDueDate').value);
            let projectActualDate=cleanDateStr(document.getElementById('projectActualDate').value);
            if(!projectName||!projectStartDate||!projectDueDate){validateRequiredFormFields(document.getElementById('projectForm'));return;}
            if(projectDueDate<=projectStartDate){markRequiredFieldInvalid(document.getElementById('projectStartDate'));markRequiredFieldInvalid(document.getElementById('projectDueDate'));showToast('Planned Completion must be later than Start');return;}
            if(projectActualDate && (projectActualDate<projectStartDate || projectActualDate>projectDueDate)) projectActualDate='';
            const createFingerprint=!id?makeCreateFingerprint('project',[projectName,projectStartDate,projectDueDate,owners.join(',')]):'';if(!beginFormSave('projectForm',createFingerprint))return;
            try{
                const existingProject=id?projectsList.find(p=>p.id==id):null;
                const proj={id:id?parseInt(id):Date.now(),name:projectName,scope:existingProject?.scope||'Projects',detail:document.getElementById('projectDetail').value.trim(),owners,status:existingProject?.status||'Not Started',progress:existingProject?.progress||0,startDate:projectStartDate,dueDate:projectDueDate,actualDate:projectActualDate,priority:existingProject?.priority||3,gainDemand:document.getElementById('projectGainDemand').value===''?'':Number(document.getElementById('projectGainDemand').value),saving:document.getElementById('projectSaving').value===''?'':Number(document.getElementById('projectSaving').value),actualSaving:document.getElementById('projectActualSaving').value===''?'':Number(document.getElementById('projectActualSaving').value),detailedStatus:document.getElementById('projectDetailedStatus').value.trim(),note:document.getElementById('projectNote').value.trim(),hoursUsed:existingProject?.hoursUsed&&typeof existingProject.hoursUsed==='object'?existingProject.hoursUsed:{},tasks:normalizeProjectTasks(existingProject?.tasks||[],{startDate:projectStartDate,dueDate:projectDueDate}),phases:normalizeProjectPhases(existingProject?.phases||[],{startDate:projectStartDate,dueDate:projectDueDate}),createdBy:existingProject?.createdBy||currentUser?.name||'',createdAt:existingProject?.createdAt||new Date().toISOString()};
                proj.hoursUsed=buildProjectStorageHours(proj);
                if(id){const idx=projectsList.findIndex(p=>p.id==id);if(idx!==-1)projectsList[idx]=proj;}else projectsList.unshift(proj);
                await saveSheetData('Projects',projectsList);
                if(!id){try{await sendPowerAutomateAssignmentNotification({type:'project',creator:proj.createdBy||currentUser?.name||'',assignees:owners,planDate:proj.dueDate,recordId:proj.id});}catch(notifyErr){console.error('Power Automate project notification error:',notifyErr);}}
                closeProjectModal();renderProjectsTable();renderGanttChart();updateDashboardCharts();showAppNotification(id?'Project updated successfully.':'Project created successfully. Use Add Phase and Add Task to build the project structure.');
            }catch(err){forgetCreateFingerprint(createFingerprint);console.error('Project save error:',err);showAppNotification(`Unable to save project. ${err?.message||err||'Unknown error'}`,'Save Error');}
            finally{endFormSave('projectForm');}
        }

async function deleteProject(id) {
            const ok = await showAppConfirm("Delete this project?");
            if (!ok) return;
            const deletedProject=projectsList.find(p=>p.id!=null && String(p.id)===String(id));
            if(deletedProject) pendingRowDeletions.Projects.add(stableRowKey('Projects',deletedProject));
            projectsList = projectsList.filter(p => p.id != id);
            await saveSheetData("Projects", projectsList);
            if(deletedProject) pendingRowDeletions.Projects.delete(stableRowKey('Projects',deletedProject));
            renderProjectsTable();
            updateDashboardCharts();
        }

        function setGanttView(view){setProjectView('gantt');}
        function changeGanttPeriod(dir){changeProjectGanttPeriod(dir);}

        
function getProjectHoursUsedMap(project){
            const raw=project?.hoursUsed&&typeof project.hoursUsed==='object'?project.hoursUsed:{};
            const map={};Object.keys(raw).forEach(k=>{if(/^\d{4}-\d{2}-\d{2}$/.test(k))map[k]=Number(raw[k])||0;});return map;
        }
        let hoursRefreshTimer=null;
        async function updateGanttHoursUsed(projectId,dateIso,value,inputEl){
            const project=projectsList.find(p=>String(p.id)===String(projectId));if(!project)return;
            const start=cleanDateStr(project.startDate),plan=cleanDateStr(project.dueDate);if(!start||!plan||dateIso<start||dateIso>plan){renderGanttChart();return;}
            const hours=Math.max(0,Math.min(24,Number(value)||0));project.hoursUsed=project.hoursUsed||{};
            // Project hours are stored only on the project. They never create Daily Tracking/My Task rows.
            project.hoursUsed[dateIso]=hours;
            project.hoursUsed.__projectMeta={gainDemand:String(project.gainDemand||''),phases:Array.isArray(project.phases)?project.phases:[],tasks:Array.isArray(project.tasks)?project.tasks:[]};
            const key=ganttHoursKey(project.id,dateIso),entry={projectId:project.id,dateIso,hours};pendingGanttHours.set(key,entry);
            if(inputEl){inputEl.value=hours||'';const td=inputEl.closest('td');if(td){td.classList.toggle('bg-amber-50',hours>0);td.classList.toggle('bg-white',hours<=0);}}
            clearTimeout(hoursRefreshTimer);hoursRefreshTimer=setTimeout(()=>{updateDashboardCharts();renderProjectsTable();},150);
            try{await saveSheetData('Projects',projectsList);if(pendingGanttHours.get(key)===entry)pendingGanttHours.delete(key);}catch(err){console.error('Gantt project hours sync error:',err);showAppNotification('Project hours were applied locally, but could not be synced to Supabase. Please try again.','Sync Error');}
        }

        
function setCalendarView(view) {
            currentCalendarView = view;
            ['week', 'month', 'year'].forEach(v => {
                const btn = document.getElementById(`calView${v.charAt(0).toUpperCase() + v.slice(1)}Btn`);
                if(btn) {
                    btn.className = v === view 
                        ? "px-2.5 py-1 rounded-md text-xs font-semibold bg-white text-indigo-600 shadow-sm transition" 
                        : "px-2.5 py-1 rounded-md text-xs font-semibold text-slate-600 hover:text-slate-800 transition";
                }
            });
            renderWeeklyCalendar();
        }

        function changeCalendarPeriod(dir) {
            if (currentCalendarView === 'week') {
                currentCalendarAnchor.setDate(currentCalendarAnchor.getDate() + (dir * 7));
            } else if (currentCalendarView === 'month') {
                currentCalendarAnchor.setMonth(currentCalendarAnchor.getMonth() + dir);
            } else if (currentCalendarView === 'year') {
                currentCalendarAnchor.setFullYear(currentCalendarAnchor.getFullYear() + dir);
            }
            renderWeeklyCalendar();
        }

        function currentPeriodToday() {
            initCalendarAnchor();
            renderWeeklyCalendar();
        }

        function getStandardDayHours(dateObj) {
            const day = dateObj.getDay();
            if (day === 0) return 0;
            if (day === 6) return 6.5;
            return 7.5;
        }

        function getTimeOffHoursForPIC(picName, dateIso) {
            let total = 0;
            timeoffOtList.forEach(o => {
                if (normalizePersonKey(o.pic) !== normalizePersonKey(picName) || normalizePersonKey(o.type) === 'over time') return;
                const start = cleanDateStr(o.startDate), end = cleanDateStr(o.endDate || o.startDate);
                if (!start || !end || dateIso < start || dateIso > end) return;
                const s = new Date(start + 'T00:00:00');
                const e = new Date(end + 'T00:00:00');
                const days = Math.max(1, Math.round((e - s) / 86400000) + 1);
                const entered = Number(o.hours) || 0;
                if (o.type === 'Saturday Off') total += Math.min(getStandardDayHours(new Date(dateIso + 'T00:00:00')) || 7, 7);
                else if (o.type === 'Day Off') total += getStandardDayHours(new Date(dateIso + 'T00:00:00'));
                else total += entered / days;
            });
            return total;
        }

        function isSaturdayOffForPIC(picName, dateIso) {
            return timeoffOtList.some(o =>
                String(o.pic || '').trim().toLowerCase() === String(picName || '').trim().toLowerCase() &&
                String(o.type || '').trim().toLowerCase() === 'saturday off' &&
                cleanDateStr(o.startDate) && cleanDateStr(o.endDate || o.startDate) &&
                cleanDateStr(o.startDate) <= dateIso && dateIso <= cleanDateStr(o.endDate || o.startDate)
            );
        }

        // Returns true when a member has a registered normal Day Off covering this date.
        // Matching is case-insensitive and supports multi-day Day Off registrations.
        function isDayOffForPIC(picName, dateIso) {
            const member = String(picName || '').trim().toLowerCase();
            return timeoffOtList.some(o => {
                const type = String(o.type || '').trim().toLowerCase();
                const itemPic = String(o.pic || '').trim().toLowerCase();
                const start = cleanDateStr(o.startDate);
                const end = cleanDateStr(o.endDate || o.startDate);
                return type === 'day off' &&
                       itemPic === member &&
                       start && end &&
                       start <= dateIso && dateIso <= end;
            });
        }

        // Calendar & Workload standard capacity.
        // IMPORTANT:
        // - Mon-Fri = 7.5h standard.
        // - Saturday = 6.5h standard.
        // - Overtime is NOT added to the denominator.
        // - Time Off is deducted from the denominator.
        // - Overtime is NOT added to the denominator.
        // Therefore workload % = total task workload / (standard hours - time off).
        function getDailyCapacityForPIC(picName, dateIso) {
            const d = new Date(dateIso + 'T00:00:00');
            const standardHours = getStandardDayHours(d);
            const timeOffHours = Math.max(0, Number(getTimeOffHoursForPIC(picName, dateIso)) || 0);
            return Math.max(0, standardHours - timeOffHours);
        }

        // Is there a Daily Tracking "Project processing" row for this PIC + project covering dateIso?
        function hasDailyProjectTaskFor(project,picName,dateIso){
            const me=String(picName||'').trim().toLowerCase();
            return dailyTasks.some(t=>{
                if(!isProjectHoursTask(t))return false;
                const linked=(String(t.projectId??'')!==''&&String(t.projectId)===String(project.id))||String(t.items||'').trim().toLowerCase()===String(project.name||'').trim().toLowerCase();
                if(!linked)return false;
                if(!taskPICs(t).some(x=>String(x).trim().toLowerCase()===me))return false;
                const s0=cleanDateStr(t.start||t.plan||t.actual),e0=cleanDateStr(t.actual||t.plan||t.start);
                return !!s0&&!!e0&&s0<=dateIso&&dateIso<=e0;
            });
        }
        // Project hours from the Gantt (projects.hours_used). Skipped when the same PIC already
        // logged a Daily Tracking "Project processing" task for that project/day (no double count).
        function getProjectHoursUsedForPIC(picName,dateIso){
            let total=0;
            projectsList.forEach(p=>{
                const owners=Array.isArray(p.owners)?p.owners:(p.owner?String(p.owner).split(',').map(x=>x.trim()).filter(Boolean):[]);
                if(!owners.some(x=>String(x).trim().toLowerCase()===String(picName).trim().toLowerCase()))return;
                const hours=p.hoursUsed&&typeof p.hoursUsed==='object'?p.hoursUsed:{};
                if(!Object.prototype.hasOwnProperty.call(hours,dateIso))return;
                if(hasDailyProjectTaskFor(p,picName,dateIso))return;
                total+=(Number(hours[dateIso])||0)/Math.max(1,owners.length);
            });
            return total;
        }

        
// Single source of truth for Calendar & Workload Utilization.
        // Utilization = TOTAL TASK WORKLOAD / (STANDARD HOURS - TIME OFF) * 100.
        // Overtime is NEVER included in either side of this formula.
        function getDailyUtilizationForPIC(picName, dateIso) {
            const availableHours = getDailyCapacityForPIC(picName, dateIso);
            const totalTaskWorkload = getDailyTaskHoursForPIC(picName, dateIso);
            return availableHours > 0
                ? Math.round((totalTaskWorkload / availableHours) * 100)
                : 0;
        }

        // Total task workload = ONLY hours assigned to actual tasks/projects.
        // Overtime is deliberately excluded from this value.
        function getDailyTaskHoursForPIC(picName, dateIso) {
            let totalHours = 0;

            // Actual working hours from Daily Tracking tasks.
            dailyTasks.forEach(t => {
                const pics = taskPICs(t);
                if (!pics.some(p => String(p).trim().toLowerCase() === String(picName).trim().toLowerCase())) return;

                // Every Daily Tracking task is workload, including "Project: Project processing".

                const startDate = cleanDateStr(t.start);
                const endDate = cleanDateStr(t.actual || t.plan);
                if (!startDate || !endDate || startDate > endDate || dateIso < startDate || dateIso > endDate) return;

                const sD = new Date(startDate + 'T00:00:00');
                const eD = new Date(endDate + 'T00:00:00');
                const diffDays = Math.max(1, Math.round((eD - sD) / 86400000) + 1);
                totalHours += (Number(t.usageTime) || 0) / diffDays;
            });

            // Project hours are actual hours as well.
            totalHours += getProjectHoursUsedForPIC(picName, dateIso);

            return totalHours;
        }

        // Actual hours used for Utilization = task workload + overtime.
        // Overtime is added only here, never to Total task workload and never
        // to the standard-hour denominator.
        function getDailyActualHoursForPIC(picName, dateIso) {
            const taskHours = getDailyTaskHoursForPIC(picName, dateIso);
            const overtimeHours = timeoffOtList
                .filter(o => {
                    const type = String(o.type || '').trim().toLowerCase();
                    const itemPic = String(o.pic || '').trim().toLowerCase();
                    const start = cleanDateStr(o.startDate);
                    const end = cleanDateStr(o.endDate || o.startDate);
                    return type === 'over time' &&
                           itemPic === String(picName || '').trim().toLowerCase() &&
                           start && end && start <= dateIso && dateIso <= end;
                })
                .reduce((sum, o) => sum + (Number(o.hours) || 0), 0);

            return taskHours + overtimeHours;
        }

        function getWorkloadGradientColor(pct) {
            const n=Math.max(0,Number(pct)||0);
            if(n<=0) return 'calendar-workload-cell bg-white text-slate-400';
            if(n<=25) return 'calendar-workload-cell bg-gradient-to-r from-slate-50 to-blue-50 text-slate-700';
            if(n<=50) return 'calendar-workload-cell bg-gradient-to-r from-blue-50 to-cyan-100 text-cyan-900 font-semibold';
            if(n<=70) return 'calendar-workload-cell bg-gradient-to-r from-cyan-100 to-emerald-100 text-emerald-900 font-bold';
            if(n<=85) return 'calendar-workload-cell bg-gradient-to-r from-emerald-100 to-lime-100 text-lime-900 font-bold';
            if(n<=100) return 'calendar-workload-cell bg-gradient-to-r from-lime-100 to-green-300 text-green-950 font-extrabold';
            if(n<=110) return 'calendar-workload-cell bg-gradient-to-r from-orange-200 to-red-400 text-red-950 font-extrabold';
            if(n<=125) return 'calendar-workload-cell bg-gradient-to-r from-red-300 to-red-600 text-white font-extrabold';
            return 'calendar-workload-cell bg-gradient-to-r from-red-500 to-red-800 text-white font-extrabold';
        }

        function renderWeeklyCalendar() {
            const headerRow = document.getElementById('weeklyHeaderRow');
            const tbody = document.getElementById('weeklyCalendarBody');
            const rangeLabel = document.getElementById('weekRangeLabel');
            if(!headerRow || !tbody) return;

            headerRow.innerHTML = '';
            tbody.innerHTML = '';

            // Calendar & Workload always shows the complete active-member list.
            // The Member filter is intentionally not applied here so no member disappears
            // from the workload matrix.
            const activeUsers = users.filter(u => u.status === 'Active' && !isHiddenMember(u.name));

            if (currentCalendarView === 'week') {
                renderWeeklyCalendarWeekView(headerRow, tbody, rangeLabel, activeUsers);
            } else if (currentCalendarView === 'month') {
                renderWeeklyCalendarMonthView(headerRow, tbody, rangeLabel, activeUsers);
            } else if (currentCalendarView === 'year') {
                renderWeeklyCalendarYearView(headerRow, tbody, rangeLabel, activeUsers);
            }

            // Keep the Dashboard & Reports copy synchronized with the main Calendar & Workload table.
            renderDashboardCalendarWorkload();
        }

        function renderDashboardCalendarWorkload() {
            const headerRow = document.getElementById('dashCalendarWorkloadHeader');
            const tbody = document.getElementById('dashCalendarWorkloadBody');
            const rangeLabel = document.getElementById('dashCalendarWorkloadRange');
            if (!headerRow || !tbody) return;

            headerRow.innerHTML = '';
            tbody.innerHTML = '';

            const activeUsers = users.filter(u =>
                u.status === 'Active' &&
                !isHiddenMember(u.name)
            );

            if (currentCalendarView === 'week') {
                renderWeeklyCalendarWeekView(headerRow, tbody, rangeLabel, activeUsers);
            } else if (currentCalendarView === 'month') {
                renderWeeklyCalendarMonthView(headerRow, tbody, rangeLabel, activeUsers);
            } else if (currentCalendarView === 'year') {
                renderWeeklyCalendarYearView(headerRow, tbody, rangeLabel, activeUsers);
            }
        }

        function renderWeeklyCalendarWeekView(headerRow, tbody, rangeLabel, activeUsers) {
            let weekDays = [];
            let tempDate = new Date(currentCalendarAnchor);
            
            const day = tempDate.getDay();
            const diff = tempDate.getDate() - day + (day === 0 ? -6 : 1);
            tempDate.setDate(diff);

            for(let i = 0; i < 6; i++) {
                weekDays.push(new Date(tempDate));
                tempDate.setDate(tempDate.getDate() + 1);
            }

            const startStr = formatDateMMDDYYYY(formatDateLocal(weekDays[0]));
            const endStr = formatDateMMDDYYYY(formatDateLocal(weekDays[5]));
            if(rangeLabel) rangeLabel.innerText = `Week: ${startStr} – ${endStr}`;

            let headerHtml = `<th class="py-3 px-4 w-40">Member</th>`;
            const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            weekDays.forEach((d, idx) => {
                headerHtml += `<th class="py-3 px-2 text-center w-28">${dayNames[idx]}<br><span class="text-[10px] font-normal text-slate-400">${formatDateMMDDYYYY(formatDateLocal(d))}</span></th>`;
            });
            headerHtml += `<th class="py-3 px-3 text-center w-32 bg-slate-200/60 text-slate-900">Week Total</th>`;
            headerRow.innerHTML = headerHtml;

            activeUsers.forEach(u => {
                let tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
                let rowHtml = `<td class="py-3 px-4 font-bold text-slate-800">${u.name}</td>`;
                
                let totalWeekTaskHours = 0;
                let totalWeekCapHours = 0;

                weekDays.forEach(d => {
                    let dateIso = formatDateLocal(d);
                    let totalDayCapacity = getDailyCapacityForPIC(u.name, dateIso);
                    let dayTaskHours = getDailyTaskHoursForPIC(u.name, dateIso);
                    totalWeekTaskHours += dayTaskHours;
                    totalWeekCapHours += totalDayCapacity;

                    if (isDayOffForPIC(u.name, dateIso)) {
                        rowHtml += `<td class="py-3 px-2 text-center font-extrabold calendar-off-cell cursor-pointer" title="Day Off" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">OFF</td>`;
                    } else if (isSaturdayOffForPIC(u.name, dateIso)) {
                        rowHtml += `<td class="py-3 px-2 text-center font-bold calendar-sat-off-cell cursor-pointer" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">SO</td>`;
                    } else if (totalDayCapacity > 0) {
                        let pct = getDailyUtilizationForPIC(u.name, dateIso);
                        if (pct > 0) {
                            let colorClass = getWorkloadGradientColor(pct);
                            rowHtml += `<td class="py-3 px-2 text-center cursor-pointer ${colorClass}" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">${pct}%</td>`;
                        } else {
                            rowHtml += `<td class="py-3 px-2 text-center text-slate-300 bg-white">-</td>`;
                        }
                    } else {
                        rowHtml += `<td class="py-3 px-2 text-center text-slate-300">-</td>`;
                    }
                });

                let totalWeekPct = totalWeekCapHours > 0 ? Math.round((totalWeekTaskHours / totalWeekCapHours) * 100) : 0;
                if (totalWeekPct > 0) {
                    let totalColorClass = getWorkloadGradientColor(totalWeekPct);
                    rowHtml += `<td class="py-3 px-3 text-center ${totalColorClass}">${totalWeekPct}%</td>`;
                } else {
                    rowHtml += `<td class="py-3 px-3 text-center text-slate-300 bg-white">-</td>`;
                }

                tr.innerHTML = rowHtml;
                tbody.appendChild(tr);
            });
        }

        function renderWeeklyCalendarMonthView(headerRow, tbody, rangeLabel, activeUsers) {
            let year = currentCalendarAnchor.getFullYear();
            let month = currentCalendarAnchor.getMonth();
            if(rangeLabel) rangeLabel.innerText = `Month: ${month + 1}/${year}`;

            let daysInMonth = new Date(year, month + 1, 0).getDate();
            let headerHtml = `<th class="py-3 px-4 w-40">Member</th>`;
            for(let d=1; d<=daysInMonth; d++) {
                headerHtml += `<th class="py-2 px-1 text-center border-r text-[10px] min-w-[32px]">${d}</th>`;
            }
            headerHtml += `<th class="py-3 px-3 text-center bg-slate-200">Month %</th>`;
            headerRow.innerHTML = headerHtml;

            activeUsers.forEach(u => {
                let tr = document.createElement('tr');
                tr.className = "border-b";
                let rowHtml = `<td class="py-2 px-4 font-bold text-slate-800">${u.name}</td>`;

                let monthTaskTotal = 0;
                let monthCapTotal = 0;

                for(let d=1; d<=daysInMonth; d++) {
                    let dObj = new Date(year, month, d);
                    let dateIso = formatDateLocal(dObj);
                    let dayTaskHours = getDailyTaskHoursForPIC(u.name, dateIso);

                    let totalDayCapacity = getDailyCapacityForPIC(u.name, dateIso);
                    monthTaskTotal += dayTaskHours;
                    monthCapTotal += totalDayCapacity;

                    if (isDayOffForPIC(u.name, dateIso)) {
                        rowHtml += `<td class="py-1 px-0.5 text-center text-[10px] border-r font-extrabold calendar-off-cell cursor-pointer" title="Day Off" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">OFF</td>`;
                    } else if (isSaturdayOffForPIC(u.name, dateIso)) {
                        rowHtml += `<td class="py-1 px-0.5 text-center text-[10px] border-r font-bold calendar-sat-off-cell cursor-pointer" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">SO</td>`;
                    } else if (totalDayCapacity > 0) {
                        let pct = getDailyUtilizationForPIC(u.name, dateIso);
                        if (pct > 0) {
                            let colorClass = getWorkloadGradientColor(pct);
                            rowHtml += `<td class="py-1 px-0.5 text-center text-[10px] border-r cursor-pointer ${colorClass}" onclick="openWorkloadSidebar('${u.name}', '${dateIso}')">${pct}%</td>`;
                        } else {
                            rowHtml += `<td class="py-1 px-0.5 text-center text-[10px] border-r bg-white text-slate-300">-</td>`;
                        }
                    } else {
                        rowHtml += `<td class="py-1 px-0.5 text-center text-[10px] border-r bg-slate-100 text-slate-400">-</td>`;
                    }
                }
                let monthPct = monthCapTotal > 0 ? Math.round((monthTaskTotal / monthCapTotal) * 100) : 0;
                if (monthPct > 0) {
                    rowHtml += `<td class="py-2 px-2 text-center font-bold ${getWorkloadGradientColor(monthPct)}">${monthPct}%</td>`;
                } else {
                    rowHtml += `<td class="py-2 px-2 text-center text-slate-300 bg-white">-</td>`;
                }

                tr.innerHTML = rowHtml;
                tbody.appendChild(tr);
            });
        }

        function renderWeeklyCalendarYearView(headerRow, tbody, rangeLabel, activeUsers) {
            let year = currentCalendarAnchor.getFullYear();
            if(rangeLabel) rangeLabel.innerText = `Year: ${year}`;

            let headerHtml = `<th class="py-3 px-4 w-40">Member</th>`;
            for(let m=1; m<=12; m++) {
                headerHtml += `<th class="py-3 px-2 text-center">M${m}</th>`;
            }
            headerHtml += `<th class="py-3 px-3 text-center bg-slate-200">Year Avg</th>`;
            headerRow.innerHTML = headerHtml;

            activeUsers.forEach(u => {
                let tr = document.createElement('tr');
                tr.className = "border-b";
                let rowHtml = `<td class="py-3 px-4 font-bold text-slate-800">${u.name}</td>`;
                let sumYearPct = 0;

                for(let m=0; m<12; m++) {
                    let daysInMonth = new Date(year, m + 1, 0).getDate();
                    let mTask = 0, mCap = 0;
                    for(let d=1; d<=daysInMonth; d++) {
                        let dObj = new Date(year, m, d);
                        let dateIso = formatDateLocal(dObj);
                        mTask += getDailyTaskHoursForPIC(u.name, dateIso);
                        mCap += getDailyCapacityForPIC(u.name, dateIso);
                    }
                    let pct = mCap > 0 ? Math.round((mTask / mCap) * 100) : 0;
                    sumYearPct += pct;
                    if (pct > 0) {
                        const midDateIso = formatDateLocal(new Date(year, m, 15));
                        rowHtml += `
                            <td class="py-3 px-2 text-center cursor-pointer ${getWorkloadGradientColor(pct)}"
                                onclick="openWorkloadSidebar('${u.name}', '${midDateIso}')">
                                ${pct}%
                            </td>`;
                    } else {
                        rowHtml += `<td class="py-3 px-2 text-center text-slate-300 bg-white">-</td>`;
                    }
                }
                let yAvg = Math.round(sumYearPct / 12);
                if (yAvg > 0) {
                    rowHtml += `<td class="py-3 px-3 text-center font-bold ${getWorkloadGradientColor(yAvg)}">${yAvg}%</td>`;
                } else {
                    rowHtml += `<td class="py-3 px-3 text-center text-slate-300 bg-white">-</td>`;
                }
                tr.innerHTML = rowHtml;
                tbody.appendChild(tr);
            });
        }

        function renderUserManagementTable() {
            const tbody=document.getElementById('userManagementTableBody'); if(!tbody) return; tbody.innerHTML='';
            users.forEach((u,idx)=>{const tr=document.createElement('tr');tr.className='border-b hover:bg-slate-50';tr.innerHTML=`
                <td class="py-3 px-4 font-bold">${escapeHtml(u.name||'')}</td><td class="py-3 px-3 text-center font-mono">${escapeHtml(String(u.password||''))}</td>
                <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">${escapeHtml(u.role||'Member')}</span></td>
                <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${u.status==='Active'?'bg-emerald-100 text-emerald-800':'bg-red-100 text-red-800'}">${escapeHtml(u.status||'Inactive')}</span></td>
                <td class="py-3 px-3 text-center">${u.role==='Admin'?`<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">${escapeHtml(u.team||'All teams')}</span>`:`<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold">${escapeHtml(u.team||'—')}</span>`}</td>
                <td class="py-3 px-4 text-center"><button onclick="openEditUserModal(${idx})" class="text-slate-400 hover:text-indigo-600 mr-3"><i class="fa-solid fa-pen-to-square"></i></button><button onclick="deleteUser(${idx})" class="text-slate-400 hover:text-red-600"><i class="fa-solid fa-trash"></i></button></td>`;tbody.appendChild(tr);});
        }
        function openAddUserModal(){
            if(currentUser?.role!=='Admin'){showAppNotification('Only Admin can manage users.','Permission denied');return;}
            document.getElementById('userEditIndex').value='';document.getElementById('userModalTitle').innerText='Add User';document.getElementById('userName').value='';document.getElementById('userPassword').value='';document.getElementById('userRole').value='Member';document.getElementById('userStatus').value='Active';
            document.getElementById('userModal').classList.remove('opacity-0','pointer-events-none');document.body.classList.add('modal-active');
        }
        function openEditUserModal(idx){
            if(currentUser?.role!=='Admin'){showAppNotification('Only Admin can manage users.','Permission denied');return;}
            const u=users[idx];if(!u)return;document.getElementById('userEditIndex').value=idx;document.getElementById('userModalTitle').innerText='Edit User';document.getElementById('userName').value=u.name||'';document.getElementById('userPassword').value=u.password||'';document.getElementById('userRole').value=u.role||'Member';document.getElementById('userStatus').value=u.status||'Active';document.getElementById('userModal').classList.remove('opacity-0','pointer-events-none');document.body.classList.add('modal-active');
        }
        function closeUserModal(){document.getElementById('userModal').classList.add('opacity-0','pointer-events-none');document.body.classList.remove('modal-active');}
        async function saveUser(e){
            e.preventDefault(); if(currentUser?.role!=='Admin'){showAppNotification('Only Admin can manage users.','Permission denied');return;}
            const idx=document.getElementById('userEditIndex').value;const name=document.getElementById('userName').value.trim();const password=document.getElementById('userPassword').value;const role=document.getElementById('userRole').value;const status=document.getElementById('userStatus').value;
            if(!name||!password)return;
            let team=role==='Admin'?'':String(document.getElementById('userTeam')?.value||'').trim();
            if(isTeamAdminSession()){
                team=String(currentUser.team||'').trim();
                if(!['Member','Viewer'].includes(role)) throw new Error('Team Admin can create or update only Member and Viewer accounts in their own team.');
            }
            if(role!=='Admin'&&!team){showAppNotification('Please select a Team for this member.','Validation');return;}
            const duplicate=users.some((u,i)=>i!==Number(idx)&&String(u.name||'').toLowerCase()===name.toLowerCase());if(duplicate){showAppNotification('Member name already exists.','Validation');return;}
            if(idx==='') users.push({name,password,role,status,team}); else { const editedIndex=Number(idx); users[editedIndex]={...users[editedIndex],name,password,role,status,team}; if(currentUser && editedIndex===users.findIndex(u=>String(u.name).toLowerCase()===String(currentUser.name).toLowerCase())) currentUser=users[editedIndex]; }
            await saveSheetData('Users',users); if(currentUser) initUserSession();
            renderUserManagementTable();populateFilterOptions();closeUserModal();showAppNotification('User saved successfully.');
        }
        async function deleteUser(idx){
            if(currentUser?.role!=='Admin'){showAppNotification('Only Admin can manage users.','Permission denied');return;}
            const ok=await showAppConfirm('Delete this user?');if(!ok)return;users.splice(idx,1);await saveSheetData('Users',users);renderUserManagementTable();populateFilterOptions();
        }

        // NEW Dashboard chart init/update

        const workloadValueLabelsPlugin = {
            id:'bomWorkloadValueLabels',
            afterDatasetsDraw(chart){
                if(chart.canvas?.id!=='chartWorkloadMember') return;
                const ctx=chart.ctx; ctx.save();
                ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font='700 10px Arial';
                // Only task counts are rendered on the bars. No percentage is rendered on any bar.
                chart.data.datasets.slice(0,3).forEach((dataset,i)=>{
                    const meta=chart.getDatasetMeta(i);
                    meta.data.forEach((bar,j)=>{
                        const v=Number(dataset.data[j]||0); if(v<=0) return;
                        ctx.fillStyle='#fff';
                        ctx.fillText(String(v),bar.x,(bar.y+bar.base)/2);
                    });
                });
                // Workload percentage is rendered ONLY for the purple line.
                const lineIndex=chart.data.datasets.findIndex(d=>d.type==='line' || d.label==='% Workload');
                if(lineIndex>=0){
                    const meta=chart.getDatasetMeta(lineIndex), vals=chart.data.datasets[lineIndex].data||[];
                    ctx.font='700 10px Arial'; ctx.textBaseline='bottom';
                    meta.data.forEach((pt,j)=>{
                        const v=Number(vals[j]); if(!Number.isFinite(v)) return;
                        const text=`${Math.round(v)}%`;
                        const y=Math.max(14,pt.y-10);
                        const w=ctx.measureText(text).width+8;
                        ctx.fillStyle='rgba(255,255,255,.96)'; ctx.fillRect(pt.x-w/2,y-12,w,15);
                        ctx.fillStyle='#334155'; ctx.fillText(text,pt.x,y);
                    });
                }
                ctx.restore();
            }
        };
        const statusPercentLabelsPlugin = {
            id:'bomStatusPercentLabels',
            afterDatasetsDraw(chart){
                if(chart.canvas?.id!=='chartTaskStatus') return;
                const meta=chart.getDatasetMeta(0), vals=chart.data.datasets?.[0]?.data||[];
                const total=vals.reduce((a,v)=>a+(Number(v)||0),0); if(!total)return;
                const ctx=chart.ctx,items=[]; ctx.save(); ctx.font='700 11px Arial'; ctx.textBaseline='middle';
                const gap=5,elbowGap=6,labelGap=7;
                meta.data.forEach((arc,i)=>{
                    const v=Number(vals[i])||0,pct=v/total*100; if(v<=0)return;
                    const angle=arc.startAngle+(arc.endAngle-arc.startAngle)/2;
                    const cos=Math.cos(angle),sin=Math.sin(angle),side=cos>=0?1:-1;
                    const text=`${pct.toFixed(1)}%`;
                    items.push({arc,side,pct,text,
                        sx:arc.x+cos*(arc.outerRadius+gap),sy:arc.y+sin*(arc.outerRadius+gap),
                        ex:arc.x+cos*(arc.outerRadius+elbowGap),ey:arc.y+sin*(arc.outerRadius+elbowGap),
                        width:ctx.measureText(text).width});
                });
                [1,-1].forEach(side=>{
                    const arr=items.filter(x=>x.side===side).sort((a,b)=>a.ey-b.ey);
                    for(let i=1;i<arr.length;i++) if(arr[i].ey-arr[i-1].ey<12) arr[i].ey=arr[i-1].ey+12;
                });
                items.forEach(item=>{
                    const side=item.side;
                    const labelX=item.arc.x+side*(item.arc.outerRadius+labelGap);
                    const elbowX=item.arc.x+side*(item.arc.outerRadius+elbowGap);
                    const lineEndX=labelX-side*2;
                    const color=(chart.data.datasets[0].backgroundColor||[])[item.arc.$context?.dataIndex]||'#94a3b8';
                    ctx.strokeStyle=color; ctx.lineWidth=1.1; ctx.lineCap='round';
                    ctx.beginPath(); ctx.moveTo(item.sx,item.sy); ctx.lineTo(item.ex,item.ey);
                    ctx.lineTo(elbowX,item.ey); ctx.lineTo(lineEndX,item.ey); ctx.stroke();
                    ctx.font='700 10px Arial'; ctx.textAlign=side>0?'left':'right'; ctx.fillStyle='#1e293b';
                    ctx.fillText(item.text,labelX,item.ey);
                    // Keep very small slices (especially Overdue) visibly identifiable.
                    if(item.pct < 2){
                        ctx.fillStyle=color; ctx.beginPath(); ctx.arc(item.arc.x + side*(item.arc.outerRadius+2), item.arc.y + Math.sin(item.arc.startAngle+(item.arc.endAngle-item.arc.startAngle)/2)*(item.arc.outerRadius-2), 4, 0, Math.PI*2); ctx.fill();
                    }
                });
                ctx.restore();
            }
        };
        Chart.register(workloadValueLabelsPlugin,statusPercentLabelsPlugin);

        function initDashboardCharts() {
            const ctx1 = document.getElementById('chartWorkloadMember');
            const ctx2 = document.getElementById('chartTaskStatus');
            if (!ctx1 || !ctx2) return;

            if (chartWorkload || chartStatus) { updateDashboardCharts(); return; }

            chartWorkload = new Chart(ctx1, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Completed',
                            data: [],
                            order: 1,
                            backgroundColor: '#10b981'
                        },
                        {
                            label: 'Working',
                            data: [],
                            order: 1,
                            backgroundColor: '#f59e0b'
                        },
                        {
                            label: 'Overdue',
                            data: [],
                            order: 1,
                            backgroundColor: '#f43f5e'
                        },
                        {
                            type: 'line',
                            label: '% Workload',
                            data: [],
                            order: 0,
                            borderColor: '#7c3aed',
                            backgroundColor: '#7c3aed',
                            yAxisID: 'yWorkload',
                            tension: 0.25,
                            borderWidth: 3,
                            pointRadius: 4,
                            pointHoverRadius: 5
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    transitions: { active: { animation: { duration: 0 } } },
                    scales: {
                        x: { stacked: false },
                        y: { stacked: false, beginAtZero: true },
                        yWorkload: { position: 'right', beginAtZero: true, suggestedMax: 100, max: 115, grid: { drawOnChartArea: false }, ticks: { callback: value => value + '%' } }
                    },
                    plugins: {
                        legend: { position: 'top' },
                        datalabels: { display: false }
                    }
                }
            });

            chartStatus = new Chart(ctx2, {
                type: 'doughnut',
                data: {
                    labels: [],
                    datasets: [{
                        data: [],
                        backgroundColor: ['#10b981', '#f59e0b', '#f43f5e', '#64748b']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    cutout: '56%',
                    radius: '78%',
                    layout: { padding: { top: 20, right: 28, bottom: 20, left: 28 } },
                    transitions: { active: { animation: { duration: 0 } } },
                    plugins: { legend: { display: false }, tooltip: { enabled: true } }
                }
            });

            updateDashboardCharts();
        }

        function getDashboardPeriodRange(){
            const years=[...bomTopFilterState.Year].map(String);
            const months=[...bomTopFilterState.Month].map(String);
            const weeks=[...bomTopFilterState.Week].map(String);
            const allDates=dailyTasks.flatMap(t=>[cleanDateStr(t.start),cleanDateStr(t.plan),cleanDateStr(t.actual)]).filter(Boolean).sort();
            const fallback=allDates.length?{start:allDates[0],end:allDates[allDates.length-1]}:{start:formatDateLocal(new Date()),end:formatDateLocal(new Date())};

            // Month always means the full BOM reporting cycle: 26th of the
            // previous calendar month through 25th of the selected month.
            if(months.length){
                const sourceYears=years.length?years:[...new Set(allDates.map(d=>d.slice(0,4)))];
                const ranges=[];
                sourceYears.forEach(y=>months.forEach(m=>{
                    const n=Number(m); if(n<1||n>12)return;
                    ranges.push({
                        start:formatDateLocal(new Date(Number(y),n-2,26)),
                        end:formatDateLocal(new Date(Number(y),n-1,25))
                    });
                }));
                if(ranges.length){
                    let start=Math.min(...ranges.map(r=>new Date(r.start+'T00:00:00').getTime()));
                    let end=Math.max(...ranges.map(r=>new Date(r.end+'T00:00:00').getTime()));
                    // If Week is also selected, keep only the selected ISO-week span.
                    if(weeks.length){
                        const dates=[];
                        for(let d=new Date(start);d<=new Date(end);d.setDate(d.getDate()+1)){
                            const iso=formatDateLocal(d);
                            if(weeks.includes(String(getIsoWeekNumber(iso))))dates.push(iso);
                        }
                        if(dates.length)return {start:dates[0],end:dates[dates.length-1]};
                    }
                    return {start:formatDateLocal(new Date(start)),end:formatDateLocal(new Date(end))};
                }
            }

            if(weeks.length){
                const sourceYears=years.length?years:[...new Set(allDates.map(d=>d.slice(0,4)))];
                const ranges=[];
                sourceYears.forEach(y=>weeks.forEach(w=>{
                    const n=Number(w); if(!Number.isFinite(n)||n<1)return;
                    const range=getIsoWeekRange(Number(y),n);
                    if(range) ranges.push(range);
                }));
                if(ranges.length)return {start:ranges.map(r=>r.start).sort()[0],end:ranges.map(r=>r.end).sort().slice(-1)[0]};
            }

            if(years.length)return {start:`${Math.min(...years.map(Number))}-01-01`,end:`${Math.max(...years.map(Number))}-12-31`};
            return fallback;
        }

        function calculateMemberCapacityForPeriod(member,start,end){
            if(!member||!start||!end||start>end)return 0;
            let total=0;
            const s=new Date(start+'T00:00:00'), e=new Date(end+'T00:00:00');

            // Standard capacity minus approved time off, day by day.
            // This is the denominator used by workload percentages.
            for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){
                const iso=formatDateLocal(d);
                total += Math.max(0, getStandardDayHours(d) - getTimeOffHoursForPIC(member,iso));
            }

            // Add approved overtime only for the separate "Available Team Hours"
            // calculation. Do not include OT in the workload-% denominator.
            timeoffOtList.forEach(o=>{
                if(String(o.pic||'').trim().toLowerCase()!==String(member||'').trim().toLowerCase())return;
                if(String(o.type||'').trim().toLowerCase()!=='over time')return;
                const os=cleanDateStr(o.startDate), oe=cleanDateStr(o.endDate||o.startDate);
                if(!os||!oe||oe<start||os>end)return;
                const overlapStart=os>start?os:start, overlapEnd=oe<end?oe:end;
                const fullDays=Math.max(1,Math.round((new Date(oe+'T00:00:00')-new Date(os+'T00:00:00'))/86400000)+1);
                const overlapDays=Math.max(1,Math.round((new Date(overlapEnd+'T00:00:00')-new Date(overlapStart+'T00:00:00'))/86400000)+1);
                total += (Number(o.hours)||0) * (overlapDays/fullDays);
            });
            return Math.max(0,total);
        }

        // Workload-% denominator: Standard hours minus time off only.
        // Approved overtime is intentionally excluded from this denominator.
        function calculateMemberStandardNetCapacityForPeriod(member,start,end){
            if(!member||!start||!end||start>end)return 0;
            let total=0;
            const s=new Date(start+'T00:00:00'), e=new Date(end+'T00:00:00');
            for(let d=new Date(s);d<=e;d.setDate(d.getDate()+1)){
                const iso=formatDateLocal(d);
                total += Math.max(0, getStandardDayHours(d) - getTimeOffHoursForPIC(member,iso));
            }
            return Math.max(0,total);
        }

        let chartAverageWorkloadTrend=null;
        let chartWorkloadHoursTrend=null;
        function getTeamReportingPeriods(){
            const years=[...bomTopFilterState.Year].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
            const months=[...bomTopFilterState.Month].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
            const weeks=[...bomTopFilterState.Week].map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
            const dates=dailyTasks.flatMap(t=>[cleanDateStr(t.start),cleanDateStr(t.plan),cleanDateStr(t.actual)]).filter(Boolean).sort();
            const fallbackYear=years[0]||Number((dates[dates.length-1]||formatDateLocal(new Date())).slice(0,4));
            const periods=[];
            const addDay=(d)=>{const iso=formatDateLocal(d);periods.push({level:'day',labelTop:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()],labelBottom:`${d.getMonth()+1}/${d.getDate()}`,start:iso,end:iso});};
            const addWeek=(year,w)=>{const r=getIsoWeekRange(year,w);if(!r)return;const st=new Date(r.start+'T00:00:00'),en=new Date(r.end+'T00:00:00');periods.push({level:'week',week:w,labelTop:`W${String(w).padStart(2,'0')}`,labelBottom:`${st.getMonth()+1}/${st.getDate()}–${en.getMonth()+1}/${en.getDate()}`,start:r.start,end:r.end});};
            const addMonth=(year,m)=>{const st=new Date(year,m-1,1),en=new Date(year,m,0);periods.push({level:'month',labelTop:st.toLocaleString('en-US',{month:'short'}),labelBottom:String(year),start:formatDateLocal(st),end:formatDateLocal(en)});};
            if(weeks.length){
                const y=years[0]||fallbackYear;
                const seen=new Set();
                weeks.forEach(w=>{const r=getIsoWeekRange(y,w);if(!r)return;for(let d=new Date(r.start+'T00:00:00');d<=new Date(r.end+'T00:00:00');d.setDate(d.getDate()+1)){const iso=formatDateLocal(d);if(seen.has(iso))continue;seen.add(iso);addDay(new Date(d));}});
                return periods;
            }
            if(months.length){
                const y=years[0]||fallbackYear;
                months.forEach(m=>{
                    const st=new Date(y,m-2,26),en=new Date(y,m-1,25),seen=new Set();
                    for(let d=new Date(st);d<=en;){
                        const a=new Date(d),b=new Date(d);b.setDate(b.getDate()+6);if(b>en)b.setTime(en.getTime());
                        // When a month is selected, split the selected BOM month range into 7-day reporting blocks.
                        const idx=Math.floor((a-st)/86400000)+1;
                        const block=Math.floor((idx-1)/7)+1;
                        const key=`${formatDateLocal(a)}_${formatDateLocal(b)}`;if(!seen.has(key)){seen.add(key);periods.push({level:'week',week:block,labelTop:`W${block}`,labelBottom:`${a.getMonth()+1}/${a.getDate()}–${b.getMonth()+1}/${b.getDate()}`,start:formatDateLocal(a),end:formatDateLocal(b)});}
                        d=new Date(b);d.setDate(d.getDate()+1);
                    }
                });
                return periods;
            }
            // Year selected without Month: use fixed 7-day blocks from Jan 1.
            // These are reporting blocks W1, W2, W3... and intentionally do not use calendar/ISO week numbers.
            if(years.length){
                years.forEach(y=>{
                    const st=new Date(y,0,1),en=new Date(y,11,31);
                    let block=1;
                    for(let d=new Date(st);d<=en;){
                        const a=new Date(d),b=new Date(d);b.setDate(b.getDate()+6);if(b>en)b.setTime(en.getTime());
                        periods.push({level:'week',week:block,labelTop:`W${block}`,labelBottom:`${a.getMonth()+1}/${a.getDate()}–${b.getMonth()+1}/${b.getDate()}`,start:formatDateLocal(a),end:formatDateLocal(b)});
                        block++; d=new Date(b);d.setDate(d.getDate()+1);
                    }
                });
                return periods;
            }
            (years.length?years:[fallbackYear]).forEach(y=>{for(let m=1;m<=12;m++)addMonth(y,m);});
            return periods;
        }

        function renderTeamWorkloadHoursTrend(filteredTasks){
            const canvas=document.getElementById('dashWorkloadHoursTrend');
            if(!canvas)return;
            const ps=getTeamReportingPeriods();
            const members=canonicalPersonList(users.filter(u=>u.status==='Active' && !isHiddenMember(u.name||'')).map(u=>u.name));
            const vals=ps.map(p=>{
                let hours=0;
                filteredTasks.forEach(t=>{
                    const usage=Number(t?.usageTime);
                    if(!Number.isFinite(usage)||usage<=0)return;
                    const st=cleanDateStr(t.start||t.plan||t.actual), en=cleanDateStr(t.actual||t.plan||t.start);
                    if(!st||!en||en<p.start||st>p.end)return;
                    const a=Math.max(new Date(st+'T00:00:00').getTime(),new Date(p.start+'T00:00:00').getTime());
                    const b=Math.min(new Date(en+'T00:00:00').getTime(),new Date(p.end+'T00:00:00').getTime());
                    const taskDays=Math.max(1,Math.round((new Date(en+'T00:00:00')-new Date(st+'T00:00:00'))/86400000)+1);
                    const overlapDays=Math.max(0,Math.round((b-a)/86400000)+1);
                    const pics=bomTaskValues('Member',t).filter(m=>!isHiddenMember(m));
                    hours+=usage*(overlapDays/taskDays)*(pics.length?1/pics.length:0);
                });
                return hours;
            });
            const availability=ps.map(p=>{
                let total=0;
                const st=new Date(p.start+'T00:00:00'), en=new Date(p.end+'T00:00:00');
                for(let d=new Date(st);d<=en;d.setDate(d.getDate()+1)){
                    const iso=formatDateLocal(d);
                    members.forEach(m=>{
                        const standard = getStandardDayHours(new Date(iso+'T00:00:00'));
                        const timeOff = getTimeOffHoursForPIC(m, iso);
                        const overtime = timeoffOtList.filter(o => {
                            const type=String(o.type||'').trim().toLowerCase();
                            const pic=String(o.pic||'').trim().toLowerCase();
                            const start=cleanDateStr(o.startDate), end=cleanDateStr(o.endDate||o.startDate);
                            return type==='over time' && pic===String(m||'').trim().toLowerCase() && start && end && start<=iso && iso<=end;
                        }).reduce((sum,o)=>sum+(Number(o.hours)||0),0);
                        const available = Math.max(0, standard - timeOff + overtime);
                        total += available;
                    });
                }
                return total;
            });
            if(!chartWorkloadHoursTrend){
                chartWorkloadHoursTrend=new Chart(canvas,{type:'bar',data:{labels:[],datasets:[
                    {label:'Workload Hours',data:[],backgroundColor:'#3b82f6',borderColor:'#3b82f6',borderWidth:0,borderRadius:5},
                    {type:'line',label:'Available Team Hours',data:[],borderColor:'#f97316',backgroundColor:'#f97316',pointBackgroundColor:'#f97316',pointBorderColor:'#f97316',pointRadius:3,pointHoverRadius:4,borderWidth:2.5,tension:.2,fill:false,order:0},
                    {type:'line',label:'Standard Time',data:[],borderColor:'#64748b',backgroundColor:'#64748b',pointRadius:0,pointHoverRadius:0,borderWidth:2,borderDash:[6,4],tension:0,fill:false,order:0}
                ]},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:true,position:'bottom',labels:{boxWidth:10,font:{size:9},padding:8}},tooltip:{enabled:false}},layout:{padding:{top:18,bottom:6}},scales:{y:{beginAtZero:true,ticks:{callback:v=>`${v}h`}},x:{ticks:{font:{size:8},maxRotation:0,autoSkip:true}}}}});
            }
            chartWorkloadHoursTrend.data.labels=ps.map(x=>[x.labelTop,x.labelBottom]);
            chartWorkloadHoursTrend.data.datasets[0].data=vals.map(x=>+x.toFixed(1));
            chartWorkloadHoursTrend.data.datasets[1].data=availability.map(x=>+x.toFixed(1));
            // Standard time is fixed at 7.5h x 9 people = 67.5h. No value label is shown for this line.
            chartWorkloadHoursTrend.data.datasets[2].data=ps.map(()=>67.5);
            if(!chartWorkloadHoursTrend._bomHoursLabels){
                const plugin={id:'bomTeamWorkloadHoursLabels',afterDatasetsDraw(chart){if(chart.canvas?.id!=='dashWorkloadHoursTrend')return;const ctx=chart.ctx;ctx.save();ctx.font='700 9px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
                    const barMeta=chart.getDatasetMeta(0),barData=chart.data.datasets[0].data||[];
                    ctx.fillStyle='#ffffff';barMeta.data.forEach((pt,i)=>{const v=Number(barData[i]);if(Number.isFinite(v)&&v>0)ctx.fillText(`${v.toFixed(1)}h`,pt.x,(pt.y+pt.base)/2);});
                    const lineMeta=chart.getDatasetMeta(1),lineData=chart.data.datasets[1].data||[];
                    ctx.font='700 9px Arial';ctx.textBaseline='bottom';ctx.fillStyle='#f97316';lineMeta.data.forEach((pt,i)=>{const v=Number(lineData[i]);if(Number.isFinite(v))ctx.fillText(`${v.toFixed(1)}h`,pt.x,Math.max(14,pt.y-9));});
                    ctx.restore();}};
                Chart.register(plugin); chartWorkloadHoursTrend._bomHoursLabels=true;
            }
            chartWorkloadHoursTrend.update('none');
        }

        function renderAverageWorkloadTrend(filteredTasks){
            const canvas=document.getElementById('dashAverageWorkloadTrend');if(!canvas)return;
            const ps=getTeamReportingPeriods();
            const selectedMembers=[...bomTopFilterState.Member],selectedKeys=new Set(selectedMembers.map(normalizePersonKey));
            const members=canonicalPersonList(users.filter(u=>u.status==='Active'&&!isHiddenMember(u.name)).map(u=>u.name)).filter(name=>!selectedMembers.length||selectedKeys.has(normalizePersonKey(name)));
            const vals=ps.map(p=>{let sum=0,n=0;members.forEach(m=>{const cap=calculateMemberStandardNetCapacityForPeriod(m,p.start,p.end);if(cap<=0)return;let h=0;filteredTasks.forEach(t=>{if(!bomTaskValues('Member',t).includes(m))return;const capTask=getCapacityTaskForDailyTask(t),usage=Number(t.usageTime),raw=(Number.isFinite(usage)&&usage>0)?usage:Number(t.workload??capTask?.workload??0)||0,st=cleanDateStr(t.start||t.plan||t.actual),en=cleanDateStr(t.actual||t.plan||t.start);if(!raw||!st||!en||en<p.start||st>p.end)return;const a=Math.max(new Date(st+'T00:00:00').getTime(),new Date(p.start+'T00:00:00').getTime()),b=Math.min(new Date(en+'T00:00:00').getTime(),new Date(p.end+'T00:00:00').getTime()),td=Math.max(1,Math.round((new Date(en)-new Date(st))/86400000)+1),od=Math.max(0,Math.round((new Date(b)-new Date(a))/86400000)+1);h+=raw*(od/td)/Math.max(1,bomTaskValues('Member',t).length);});sum+=h/cap*100;n++;});return n?sum/n:0;});
            if(!chartAverageWorkloadTrend)chartAverageWorkloadTrend=new Chart(canvas,{type:'line',data:{labels:[],datasets:[{label:'Average % Workload',data:[],borderColor:'#7c3aed',backgroundColor:'rgba(124,58,237,.12)',fill:true,tension:.25,borderWidth:2,pointRadius:4,pointHoverRadius:5}]},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${Math.round(c.parsed.y)}%`}}},layout:{padding:{top:22,bottom:4}},scales:{y:{beginAtZero:true,suggestedMax:100,ticks:{callback:v=>v+'%'}}}}});
            chartAverageWorkloadTrend.data.labels=ps.map(x=>[x.labelTop,x.labelBottom]);
            chartAverageWorkloadTrend.data.datasets[0].data=vals.map(x=>+x.toFixed(1));
            chartAverageWorkloadTrend.options.plugins.datalabels=undefined;
            chartAverageWorkloadTrend.update('none');
            // Draw the exact percentage above every point.
            if(!chartAverageWorkloadTrend._bomPctPlugin){
                const plugin={id:'bomTeamWorkloadLabels',afterDatasetsDraw(chart){if(chart.canvas?.id!=='dashAverageWorkloadTrend')return;const ctx=chart.ctx,meta=chart.getDatasetMeta(0);ctx.save();ctx.font='700 10px Arial';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#334155';meta.data.forEach((pt,i)=>{const v=Number(chart.data.datasets[0].data[i]);if(Number.isFinite(v))ctx.fillText(`${Math.round(v)}%`,pt.x,Math.max(14,pt.y-9));});ctx.restore();}};
                chartAverageWorkloadTrend.config.plugins=(chartAverageWorkloadTrend.config.plugins||[]).concat(plugin);chartAverageWorkloadTrend._bomPctPlugin=true;Chart.register(plugin);
            }
            chartAverageWorkloadTrend.update('none');
        }

        function updateDashboardCharts() {
            if (!chartWorkload || !chartStatus) return;

            // Recompute metadata
            dailyTasks.forEach(t => calculateTaskMetadata(t));

            let filteredTasks = (window.bomFilteredTasks || dailyTasks.filter(taskPassesBomTopFilters)).filter(taskIncludedInStatistics);

            const total = filteredTasks.length;
            const completed = filteredTasks.filter(t => t.status === 'Completed').length;
            const working = filteredTasks.filter(t => t.status === 'Working').length;
            const overdue = filteredTasks.filter(t => t.status === 'Overdue').length;
            const others = total - completed - working - overdue;

            const onTime = filteredTasks.filter(t => t.discipline === 'On Time').length;
            const passDue = filteredTasks.filter(t => t.discipline === 'Overdue').length;
            const totalDisc = onTime + passDue;

            document.getElementById('dashTotalTasks').innerText = total.toLocaleString();
            document.getElementById('dashCompletedTasks').innerText = completed.toLocaleString();
            document.getElementById('dashCompletedRate').innerText = total ? ((completed / total) * 100).toFixed(1) + '% of total' : '0%';
            document.getElementById('dashOnTimeRate').innerText = totalDisc ? ((onTime / totalDisc) * 100).toFixed(1) + '%' : '0%';
            document.getElementById('dashOverdueTasks').innerText = overdue.toLocaleString();
            document.getElementById('dashWorkingTasks').innerText = working.toLocaleString();

            const activeUsers = users.filter(u => u.status === 'Active' && !isHiddenMember(u.name));
            const selectedMembers=[...bomTopFilterState.Member];
            const selectedMemberKeys=new Set(selectedMembers.map(normalizePersonKey));
            const activeNames=canonicalPersonList(activeUsers.map(u=>u.name)).filter(name=>!isHiddenMember(name));
            const labels=(selectedMembers.length?activeNames.filter(name=>selectedMemberKeys.has(normalizePersonKey(name))):activeNames);

            const picAgg = {};
            labels.forEach(name => {
                picAgg[name] = { Completed: 0, Working: 0, Overdue: 0 };
            });

            filteredTasks.forEach(t => {
                const pics=taskPICs(t);
                pics.forEach(p => {
                    if (!picAgg[p]) return;
                    if (t.status === 'Completed') picAgg[p].Completed++;
                    else if (t.status === 'Overdue') picAgg[p].Overdue++;
                    else picAgg[p].Working++;
                });
            });

            chartWorkload.data.labels = labels;
            chartWorkload.data.datasets[0].data = labels.map(l => picAgg[l].Completed);
            chartWorkload.data.datasets[1].data = labels.map(l => picAgg[l].Working);
            chartWorkload.data.datasets[2].data = labels.map(l => picAgg[l].Overdue);
            const pr=getDashboardPeriodRange();
            const memberWorkloadHours={}; labels.forEach(l=>memberWorkloadHours[l]=0);
            filteredTasks.forEach(t=>{
                const pics=bomTaskValues('Member',t), share=pics.length?1/pics.length:0;
                const capTask=getCapacityTaskForDailyTask(t), usage=Number(t.usageTime), raw=(Number.isFinite(usage)&&usage>0)?usage:Number(t.workload??capTask?.workload??0)||0;
                const st=cleanDateStr(t.start||t.plan||t.actual), en=cleanDateStr(t.actual||t.plan||t.start);
                if(!raw||!st||!en||en<pr.start||st>pr.end)return;
                const a=new Date(Math.max(new Date(st+'T00:00:00').getTime(),new Date(pr.start+'T00:00:00').getTime()));
                const b=new Date(Math.min(new Date(en+'T00:00:00').getTime(),new Date(pr.end+'T00:00:00').getTime()));
                const totalDays=Math.max(1,Math.round((new Date(en+'T00:00:00')-new Date(st+'T00:00:00'))/86400000)+1);
                const overlapDays=Math.max(0,Math.round((b-a)/86400000)+1);
                const h=raw*(overlapDays/totalDays)*share;
                pics.forEach(p=>{if(memberWorkloadHours[p]!==undefined)memberWorkloadHours[p]+=h;});
            });
            // % Workload = Total task workload / (Standard hours - Time Off).
            // Overtime is excluded from the denominator for this percentage line.
            chartWorkload.data.datasets[3].data=labels.map(l=>{const cap=calculateMemberStandardNetCapacityForPeriod(l,pr.start,pr.end);return cap>0?Math.round(memberWorkloadHours[l]/cap*100):0;});
            chartWorkload.update("none");

            const statusCounts = {
                Completed: completed,
                Working: working,
                Overdue: overdue,
                Other: others
            };
            chartStatus.data.labels = Object.keys(statusCounts);
            chartStatus.data.datasets[0].data = Object.values(statusCounts);
            chartStatus.update("none");

            const legendEl = document.getElementById('dashStatusLegend');
            const totalStatus = Object.values(statusCounts).reduce((a, b) => a + b, 0);
            const statusColors = { Completed: '#10b981', Working: '#f59e0b', Overdue: '#f43f5e', Other: '#64748b' };
            legendEl.innerHTML = Object.keys(statusCounts).map(lbl => {
                const cnt = statusCounts[lbl];
                const pct = totalStatus ? ((cnt / totalStatus) * 100).toFixed(1) : '0';
                return `
                    <div class="flex items-center space-x-1.5">
                        <span class="w-3 h-3 rounded-full inline-block" style="background-color:${statusColors[lbl]}"></span>
                        <span class="text-slate-600 font-medium">${lbl}:</span>
                        <span class="font-bold text-slate-800">${cnt} (${pct}%)</span>
                    </div>
                `;
            }).join('');

            renderStatusTrackingTableForDashboard(filteredTasks);
            renderDashboardWorkloadSummary(filteredTasks);
            renderOvertimeByMemberTable();
            renderScopeWorkloadHeatmap(filteredTasks);
            renderAverageWorkloadTrend(filteredTasks);
            renderTeamWorkloadHoursTrend(filteredTasks);
            updateDashboardFinancialKpis();
        }

        function openWorkloadSidebar(userName, dateIso) {
            const content = document.getElementById('workloadSidebarContent');
            const dateStr = formatDateMMDDYYYY(dateIso);

            const dObj = new Date(dateIso);
            const stdHours = getStandardDayHours(dObj);

            const dayOffs = timeoffOtList.filter(o => {
                const start = cleanDateStr(o.startDate);
                const end = cleanDateStr(o.endDate || o.startDate);
                return String(o.pic || '').trim().toLowerCase() === String(userName || '').trim().toLowerCase()
                    && start && end && start <= dateIso && dateIso <= end;
            });
            const otReq = dayOffs.filter(o => String(o.type || '').trim().toLowerCase() === 'over time');
            const dayOffReq = dayOffs.filter(o => String(o.type || '').trim().toLowerCase() === 'day off');
            const timeOffReq = dayOffs.filter(o => {
                const type = String(o.type || '').trim().toLowerCase();
                return type === 'time off' || type === 'saturday off';
            });

            const otHours = otReq.reduce((sum, o) => sum + (parseFloat(o.hours) || 0), 0);
            // Day Off is displayed as Time off in hours in this sidebar.
            // Normal Day Off = 7.5h; Saturday Off = 6.5h.
            const dayOffHours = dayOffReq.reduce((sum, o) => sum + (dateIso && new Date(dateIso + 'T00:00:00').getDay() === 6 ? 6.5 : 7.5), 0);
            const registeredTimeOffHours = timeOffReq.reduce((sum, o) => sum + (parseFloat(o.hours) || 0), 0);
            const timeOffHours = dayOffHours + registeredTimeOffHours;

            const totalCapacity = getDailyCapacityForPIC(userName, dateIso);
            const tasksForDay = dailyTasks.filter(t => {
                const pics=taskPICs(t);
                if (!pics.some(pic=>normalizePersonKey(pic)===normalizePersonKey(userName))) return false;
                if (!t.start || !(t.actual || t.plan)) return false;
                return t.start <= dateIso && dateIso <= (t.actual || t.plan);
            });

            const taskDetails = tasksForDay.map(t => {
                const pics=taskPICs(t);
                let sD = new Date(t.start);
                let eD = new Date(t.actual || t.plan);
                let diffDays = Math.max(1, Math.round((eD - sD) / (1000*60*60*24)) + 1);
                let shareHours = (Number(t.usageTime) || 0) / diffDays;
                return { task: t, hours: shareHours };
            });

            // Use exactly the same Total task workload value shown below
            // to calculate Utilization. OT is deliberately excluded.
            const totalTaskHours = getDailyTaskHoursForPIC(userName, dateIso);
            const availableHours = Math.max(0, stdHours - timeOffHours);
            const pct = availableHours > 0 ? Math.round((totalTaskHours / availableHours) * 100) : 0;

            let html = `
                <div class="space-y-1">
                    <div class="font-bold text-slate-800 text-sm">${userName}</div>
                    <div class="text-slate-500">Date: ${dateStr}</div>
                </div>
                <div class="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-1">
                    <div class="flex justify-between">
                        <span>Standard hours:</span><span class="font-bold">${stdHours.toFixed(2)} h</span>
                    </div>
                    ${timeOffHours > 0 ? `
                    <div class="flex justify-between">
                        <span>Time off:</span><span class="font-bold text-cyan-700">${timeOffHours.toFixed(2)} h</span>
                    </div>
                    ` : ''}
                    <div class="flex justify-between">
                        <span>Overtime hours:</span><span class="font-bold text-amber-700">${otHours.toFixed(2)} h</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Available hours after time off:</span><span class="font-bold text-emerald-700">${totalCapacity.toFixed(2)} h</span>
                    </div>
                    <div class="flex justify-between">
                        <span>Total task workload:</span><span class="font-bold text-indigo-700">${totalTaskHours.toFixed(2)} h</span>
                    </div>
                    <div class="flex justify-between mt-1">
                        <span>Utilization:</span><span class="font-bold">${pct}%</span>
                    </div>
                </div>
            `;

            if (taskDetails.length > 0) {
                html += `<div class="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div class="font-bold text-slate-800 mb-1">Task list</div>
                    <div class="space-y-1">
                `;
                taskDetails.forEach(td => {
                    html += `
                        <div class="text-[11px] border-b border-slate-100 pb-2">
                            <div class="font-semibold text-slate-800" title="${escapeHtml((td.task.category || '') + ': ' + (td.task.name || ''))}">${escapeHtml(td.task.category || 'Other')}: ${escapeHtml(td.task.name || '-')}</div>
                            <div class="text-slate-500 whitespace-normal mt-0.5">${escapeHtml(td.task.items || 'No detail task')}</div>
                            <div class="font-bold text-indigo-700 mt-0.5">Workload: ${td.hours.toFixed(2)} h</div>
                        </div>
                    `;
                });
                html += `</div></div>`;
            } else {
                html += `<div class="border border-slate-200 rounded-lg p-3 text-slate-500 text-[11px]">No tasks registered for this day.</div>`;
            }

            content.innerHTML = html;
            document.getElementById('workloadSidebar').classList.remove('translate-x-full');
        }

        function closeWorkloadSidebar() {
            document.getElementById('workloadSidebar').classList.add('translate-x-full');
        }

        function renderStatusTrackingTableForDashboard(filteredTasks) {
            const body = document.getElementById('dashTablePicStatusBody');
            if (!body) return;

            const pivot = {};
            canonicalPersonList(users
                .filter(u=>u.status==='Active'&&!isHiddenMember(u.name||u.username||''))
                .map(u=>u.name||u.username||'')
            ).forEach(name=>{
                pivot[name]={Completed:0,Working:0,Overdue:0,Other:0,Total:0};
            });
            filteredTasks.forEach(t => {
                const pics=taskPICs(t);
                pics.forEach(p => {
                    if (!pivot[p]) return;
                    if (t.status === 'Completed') pivot[p].Completed++;
                    else if (t.status === 'Overdue') pivot[p].Overdue++;
                    else if (t.status === 'Working') pivot[p].Working++;
                    else pivot[p].Other++;
                    pivot[p].Total++;
                });
            });

            const keys = Object.keys(pivot).sort();
            body.innerHTML = keys.map(pic => {
                const row = pivot[pic];
                return `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="py-2 px-3 font-bold text-slate-800">${pic}</td>
                        <td class="py-2 px-2 text-center text-emerald-600 font-semibold">
                            ${row.Completed}
                        </td>
                        <td class="py-2 px-2 text-center text-amber-600 font-semibold">
                            ${row.Working}
                        </td>
                        <td class="py-2 px-2 text-center text-rose-600 font-semibold">
                            ${row.Overdue}
                        </td>
                        <td class="py-2 px-2 text-center text-slate-500">
                            ${row.Other}
                        </td>
                        <td class="py-2 px-3 text-center font-extrabold text-slate-900 bg-slate-50">
                            ${row.Total}
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function renderOvertimeByMemberTable(){
            const head=document.getElementById('dashOvertimeTableHeader'), body=document.getElementById('dashOvertimeTableBody');if(!head||!body)return;
            const selectedMembers=[...bomTopFilterState.Member], selectedKeys=new Set(selectedMembers.map(normalizePersonKey));
            const members=canonicalPersonList(users.filter(u=>u.status==='Active'&&!isHiddenMember(u.name)).map(u=>u.name))
                .filter(name=>!selectedMembers.length||selectedKeys.has(normalizePersonKey(name)))
                .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
            const periods=getTeamReportingPeriods();
            const headerCells=periods.map(p=>`<th class="py-2.5 px-2 text-center whitespace-nowrap"><div class="font-bold">${p.labelTop}</div><div class="text-[9px] font-normal opacity-80">${p.labelBottom}</div></th>`).join('');
            head.innerHTML=`<tr><th class="py-2.5 px-3 bg-slate-900 whitespace-nowrap">Member</th>${headerCells}<th class="py-2.5 px-2 text-center bg-orange-700 whitespace-nowrap">Total</th></tr>`;
            const overlapHours=(o,ps,pe)=>{const os=cleanDateStr(o.startDate),oe=cleanDateStr(o.endDate||o.startDate);if(!os||!oe||oe<ps||os>pe)return 0;const a=new Date(Math.max(new Date(os+'T00:00:00').getTime(),new Date(ps+'T00:00:00').getTime())),b=new Date(Math.min(new Date(oe+'T00:00:00').getTime(),new Date(pe+'T00:00:00').getTime()));const days=Math.max(1,Math.round((new Date(oe)-new Date(os))/86400000)+1),overlap=Math.max(1,Math.round((b-a)/86400000)+1);return(Number(o.hours)||0)*(overlap/days);};
            body.innerHTML=members.length?members.map(m=>{let total=0;const cells=periods.map(p=>{const h=timeoffOtList.filter(o=>String(o.type||'').trim().toLowerCase()==='over time'&&normalizePersonKey(o.pic)===normalizePersonKey(m)).reduce((sum,o)=>sum+overlapHours(o,p.start,p.end),0);total+=h;return`<td class="py-2 px-2 text-center font-semibold text-orange-700 whitespace-nowrap">${h?h.toFixed(1):'-'}</td>`;}).join('');return`<tr><td class="py-2 px-3 font-bold text-slate-800 whitespace-nowrap">${escapeHtml(m)}</td>${cells}<td class="py-2 px-2 text-center font-extrabold bg-orange-50 whitespace-nowrap">${total.toFixed(1)}</td></tr>`;}).join(''):'<tr><td colspan="20" class="py-4 text-center text-slate-400">No data</td></tr>';
        }

        function getDashboardHeatmapStyle(pct){
            const n=Math.max(0,Number(pct)||0);
            if(n<=0) return 'background:#f8fafc;color:#94a3b8;';
            const stops=[[0,'#dbeafe'],[25,'#bfdbfe'],[50,'#93c5fd'],[75,'#60a5fa'],[100,'#3b82f6'],[120,'#2563eb']];
            let a=stops[0],b=stops[stops.length-1];
            for(let i=0;i<stops.length-1;i++){if(n>=stops[i][0]&&n<=stops[i+1][0]){a=stops[i];b=stops[i+1];break;}}
            const t=Math.max(0,Math.min(1,(n-a[0])/(b[0]-a[0])));
            const rgb=h=>{h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]};
            const ar=rgb(a[1]),br=rgb(b[1]),c=ar.map((v,i)=>Math.round(v+(br[i]-v)*t));
            const lum=(0.299*c[0]+0.587*c[1]+0.114*c[2])/255;
            return `background:rgb(${c.join(',')});color:${lum>0.60?'#1e3a5f':'#ffffff'};transition:background .2s ease,color .2s ease;`;
        }

        function normalizeWorkloadKey(value){
            return String(value??'').trim().replace(/\s+/g,' ').toLowerCase();
        }
        function getCapacityTaskForDailyTask(task){
            const cat=normalizeWorkloadKey(task?.category);
            const name=normalizeWorkloadKey(task?.name ?? task?.taskName ?? task?.task);
            if(!cat||!name)return null;
            return capacityData.find(c=>normalizeWorkloadKey(c.category)===cat&&normalizeWorkloadKey(c.task)===name&&teamMatch(c,task))||null;
        }
        function getDailyTaskScope(task){
            const explicit=String(task?.scope||'').trim();
            if(explicit) return explicit;
            const c=getCapacityTaskForDailyTask(task);
            return String(c?.scope||c?.unit||"In BOM's scope").trim()||"In BOM's scope";
        }

        function renderScopeWorkloadHeatmap(filteredTasks){
            const head=document.getElementById('dashScopeHeatmapHeader'),body=document.getElementById('dashScopeHeatmapBody'); if(!head||!body)return;
            const members=[...new Set(filteredTasks.flatMap(t=>bomTaskValues('Member',t)))].filter(m=>m&&!isHiddenMember(m)).sort((a,b)=>a.localeCompare(b));
            const scopes=[...new Set([...capacityData.map(c=>String(c.scope||c.unit||"In BOM's scope").trim()), ...filteredTasks.map(getDailyTaskScope)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
            const pr=getDashboardPeriodRange();
            head.innerHTML='<tr><th class="py-2.5 px-3 bg-slate-900">Scope</th>'+members.map(m=>`<th class="py-2 px-2 text-center bg-slate-900">${escapeHtml(m)}</th>`).join('')+'<th class="py-2.5 px-3 text-center bg-indigo-900">Total %</th></tr>';
            if(!members.length||!scopes.length){body.innerHTML='<tr><td colspan="20" class="py-4 text-center text-slate-400">No scope workload data</td></tr>';return;}
            const cap={}; members.forEach(m=>cap[m]=calculateMemberCapacityForPeriod(m,pr.start,pr.end));
            const taskHours=t=>{
                const capTask=getCapacityTaskForDailyTask(t); const usage=Number(t.usageTime); const h=(Number.isFinite(usage)&&usage>0)?usage:Number(t.workload??capTask?.workload??0)||0; if(h<=0)return 0;
                const st=cleanDateStr(t.start||t.plan||t.actual),en=cleanDateStr(t.actual||t.plan||t.start);
                if(!st||!en)return h;if(en<pr.start||st>pr.end)return 0;
                const a=new Date(Math.max(new Date(st+'T00:00:00').getTime(),new Date(pr.start+'T00:00:00').getTime()));
                const b=new Date(Math.min(new Date(en+'T00:00:00').getTime(),new Date(pr.end+'T00:00:00').getTime()));
                const totalDays=Math.max(1,Math.round((new Date(en)-new Date(st))/86400000)+1),overlapDays=Math.max(0,Math.round((b-a)/86400000)+1);
                return h*(overlapDays/totalDays);
            };
            body.innerHTML=scopes.map(sc=>{
                let scopeHours=0,scopeCapacity=0;
                const cells=members.map(m=>{let h=0;filteredTasks.forEach(t=>{if(bomTaskValues('Member',t).includes(m)&&getDailyTaskScope(t)===sc)h+=taskHours(t)/Math.max(1,bomTaskValues('Member',t).length);});scopeHours+=h;scopeCapacity+=cap[m]||0;const pct=cap[m]>0?h/cap[m]*100:0;return `<td class="py-2 px-2 text-center font-bold" style="${getDashboardHeatmapStyle(pct)}" title="${h.toFixed(2)} h / ${cap[m].toFixed(2)} h available">${pct?pct.toFixed(1)+'%':'-'}</td>`;}).join('');
                const total=scopeCapacity>0?scopeHours/scopeCapacity*100:0;
                return `<tr><td class="py-2 px-3 font-semibold">${escapeHtml(sc)}</td>${cells}<td class="py-2 px-3 text-center font-extrabold" style="${getDashboardHeatmapStyle(total)}" title="${scopeHours.toFixed(2)} h / ${scopeCapacity.toFixed(2)} h available">${total.toFixed(1)}%</td></tr>`;
            }).join('');
        }

        function renderRankingTableForDashboard(filteredTasks) {
            const body = document.getElementById('dashRankingTableBody');
            if (!body) return;

            const picMap = {};
            filteredTasks.forEach(t => {
                const pics=reportableTaskPICs(t);
                pics.forEach(p => {
                    if (!picMap[p]) picMap[p] = { total: 0, completed: 0, ontime: 0, passdue: 0 };
                    picMap[p].total++;
                    if (t.status === 'Completed') picMap[p].completed++;
                    if (t.discipline === 'On Time') picMap[p].ontime++;
                    if (t.discipline === 'Overdue') picMap[p].passdue++;
                });
            });

            const list = Object.keys(picMap).map(pic => {
                const r = picMap[pic];
                const discTotal = r.ontime + r.passdue;
                const onRate = discTotal ? (r.ontime / discTotal) * 100 : 0;
                return { pic, ...r, onRate };
            }).sort((a, b) => b.onRate - a.onRate || b.total - a.total);

            if (list.length === 0) {
                body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-400">No data</td></tr>';
                return;
            }

            body.innerHTML = list.map((r, idx) => `
                <tr class="hover:bg-slate-50 transition">
                    <td class="py-2.5 px-3 text-center font-bold text-slate-600">${idx + 1}</td>
                    <td class="py-2.5 px-3 font-bold text-slate-800">${r.pic}</td>
                    <td class="py-2.5 px-3 text-center font-semibold text-slate-700">${r.total}</td>
                    <td class="py-2.5 px-3 text-center text-emerald-600 font-medium">${r.completed}</td>
                    <td class="py-2.5 px-3 text-center text-indigo-600 font-medium">${r.ontime}</td>
                    <td class="py-2.5 px-3 text-center text-rose-500 font-medium">${r.passdue}</td>
                    <td class="py-2.5 px-3 text-center font-extrabold text-indigo-700 bg-indigo-50/60">${r.onRate.toFixed(1)}%</td>
                </tr>
            `).join('');
        }

        function renderDetailTableForDashboard(filteredTasks) {
            const body = document.getElementById('dashDetailTableBody');
            if (!body) return;

            const sample = filteredTasks.slice(0, 50);
            if (sample.length === 0) {
                body.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-400">No tasks</td></tr>';
                return;
            }

            body.innerHTML = sample.map(t => {
                let statusBadgeClass =
                    t.status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                    t.status === 'Overdue' ? 'bg-rose-100 text-rose-800' :
                    'bg-amber-100 text-amber-800';

                return `
                    <tr class="hover:bg-slate-50">
                        <td class="py-2 px-2 text-slate-600 font-medium">${t.category || '-'}</td>
                        <td class="py-2 px-2 font-medium text-slate-800 truncate" title="${t.name}">${t.name}</td>
                        <td class="py-2 px-2 font-bold">${t.pic || (t.pics && t.pics.join(', ')) || '-'}</td>
                        <td class="py-2 px-2 text-center text-[11px]">${t.start || '-'}</td>
                        <td class="py-2 px-2 text-center text-[11px] text-blue-600 font-semibold">${t.plan || '-'}</td>
                        <td class="py-2 px-2 text-center text-[11px] ${t.actual ? 'text-emerald-600 font-semibold' : 'text-slate-400'}">${t.actual || '-'}</td>
                        <td class="py-2 px-2 text-center">
                            <span class="px-2 py-0.5 rounded text-[10px] ${statusBadgeClass}">${t.status}</span>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function showAppNotification(message, title = "Notification") {
            document.getElementById('appNotificationTitle').innerText = title;
            document.getElementById('appNotificationMessage').innerText = message;
            document.getElementById('appNotificationButtons').innerHTML = `
                <button onclick="closeAppNotification()" class="px-3 py-1.5 text-xs bg-slate-200 hover:bg-slate-300 rounded-lg font-semibold text-slate-700">OK</button>
            `;
            document.getElementById('appNotificationModal').classList.remove('opacity-0', 'pointer-events-none');
            document.body.classList.add('modal-active');
        }

        function showAppConfirm(message, title = "Confirm") {
            return new Promise(resolve => {
                appNotificationResolve = resolve;
                document.getElementById('appNotificationTitle').innerText = title;
                document.getElementById('appNotificationMessage').innerText = message;
                document.getElementById('appNotificationButtons').innerHTML = `
                    <button onclick="handleAppConfirm(false)" class="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg font-semibold text-slate-700">Cancel</button>
                    <button onclick="handleAppConfirm(true)" class="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 rounded-lg font-semibold text-white">OK</button>
                `;
                document.getElementById('appNotificationModal').classList.remove('opacity-0', 'pointer-events-none');
                document.body.classList.add('modal-active');
            });
        }

        function handleAppConfirm(val) {
            closeAppNotification();
            if (appNotificationResolve) {
                appNotificationResolve(val);
                appNotificationResolve = null;
            }
        }

        function closeAppNotification() {
            document.getElementById('appNotificationModal').classList.add('opacity-0', 'pointer-events-none');
            document.body.classList.remove('modal-active');
        }

        function normalizeRowsForDatabase(sheetName, rows){
            const clone=JSON.parse(JSON.stringify(Array.isArray(rows)?rows:[]));
            // Client-only metadata must never be written into the JSONB data column.
            clone.forEach(row=>{ if(row && typeof row==='object') delete row._supabaseRecordId; });
            const dateKeysBySheet={
                Projects:['startDate','dueDate','actualDate','start','plan','actual'],
                TimeOff_OT:['startDate','endDate']
            };
            const keys=dateKeysBySheet[sheetName]||[];
            if(!keys.length)return clone;
            clone.forEach(row=>keys.forEach(k=>{
                const v=row?.[k];
                if(typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) row[k]=`${v}T12:00:00.000Z`;
            }));
            return clone;
        }
    
