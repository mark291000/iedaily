(function(){
  'use strict';

  function v51Today(){
    const d=new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate());
  }
  function v51Date(v){
    const s=typeof cleanDateStr==='function'?cleanDateStr(v):String(v||'').slice(0,10);
    return s?new Date(s+'T00:00:00'):null;
  }
  function v51HasValue(v){
    return v!==null && v!==undefined && String(v).trim()!=='';
  }
  // Saving values are numeric database fields. Accept normal decimal input and
  // also tolerate pasted values such as "1,234.50" without turning them into null.
  function v52Number(v){
    if(v===null || v===undefined || String(v).trim()==='') return null;
    const raw=String(v).trim().replace(/[$€£¥\s]/g,'');
    const normalized=raw.includes(',') && !raw.includes('.')
      ? raw.replace(',', '.')
      : raw.replace(/,/g,'');
    const n=Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  function v51Children(project){
    const phases=Array.isArray(project?.phases)?project.phases:[];
    const phaseTasks=phases.flatMap(ph=>Array.isArray(ph?.tasks)?ph.tasks:[]);
    const direct=Array.isArray(project?.tasks)?project.tasks:[];
    return phaseTasks.concat(direct);
  }

  /*
   * A project may legitimately have no Phase/Task.
   * In that case its status is derived from the project dates/actual date.
   * Priority of the project-level information:
   *   Actual date -> Completed
   *   Start >= today and no Actual -> Working (requested rule)
   *   Start < today, Due < today -> Overdue
   *   Otherwise -> Working
   */
  function v51ProjectOnlyStatus(project){
    const actual=cleanDateStr(project?.actualDate);
    const start=cleanDateStr(project?.startDate);
    const due=cleanDateStr(project?.dueDate);
    if(actual) return 'Completed';
    const today=v51Today();
    const sd=v51Date(start), dd=v51Date(due);
    if(sd && sd>=today) return 'Working';
    if(dd && dd<today) return 'Overdue';
    return 'Working';
  }

  /*
   * Saving rule:
   * - No child saving has been entered: keep the values entered in Create/Edit Project.
   * - Once a Phase/Task contains a saving value, project saving becomes the child total.
   * This preserves project-only rows while retaining the existing roll-up behavior.
   */
  function v51AggregateSaving(project){
    const children=v51Children(project);
    const estValues=children.map(t=>v52Number(t?.estSaving)).filter(v=>v!==null);
    const actValues=children.map(t=>v52Number(t?.actualSaving)).filter(v=>v!==null);

    // IMPORTANT: Project popup values remain the displayed values until a task
    // actually contains a saving value. Once task saving exists, the project row
    // switches to the sum of task values (including zero-valued tasks).
    const hasEst=estValues.length>0;
    const hasAct=actValues.length>0;
    const projectEst=v52Number(project?.saving);
    const projectAct=v52Number(project?.actualSaving);
    return {
      saving:hasEst ? estValues.reduce((a,b)=>a+b,0) : (projectEst===null?0:projectEst),
      actualSaving:hasAct ? actValues.reduce((a,b)=>a+b,0) : (projectAct===null?0:projectAct),
      hasChildSaving:hasEst||hasAct
    };
  }

  window.getProjectSavingDisplayValues=function(project){
    return v51AggregateSaving(project);
  };

  const oldAggregate=window.projectAggregateSummary;
  window.projectAggregateSummary=function(project){
    const base=typeof oldAggregate==='function'
      ? oldAggregate(project)
      : {gainDemand:0,saving:0,actualSaving:0};
    const sv=v51AggregateSaving(project);
    return {
      gainDemand:Number(base?.gainDemand)||0,
      saving:sv.saving,
      actualSaving:sv.actualSaving
    };
  };

  const oldOverall=window.calculateProjectOverallStatus;
  window.calculateProjectOverallStatus=function(project){
    const children=v51Children(project);
    if(!children.length) return v51ProjectOnlyStatus(project);
    if(typeof oldOverall==='function') return oldOverall(project);
    return 'Not Started';
  };

  function v51RefreshProjectOnlyStatuses(){
    (window.projectsList||[]).forEach(p=>{
      // Normalize only the project-level fields; task fields are left untouched.
      if(v51HasValue(p?.saving)) p.saving=v52Number(p.saving);
      if(v51HasValue(p?.actualSaving)) p.actualSaving=v52Number(p.actualSaving);
      if(!v51Children(p).length){
        p.status=v51ProjectOnlyStatus(p);
      }
    });
  }

  /*
   * Fast Project modal save:
   * The old save path called saveSheetData('Projects', projectsList), which
   * synchronizes every project plus all relational Phase/Task rows.
   * Creating a project with no children only needs one INSERT.
   * Editing a project only needs one UPDATE.
   */
  const v51OriginalSaveProject=window.saveProject;
  window.saveProject=async function(e){
    e?.preventDefault?.();

    if(!window.initSupabaseClient || !initSupabaseClient()){
      showAppNotification((window.supabaseInitError?.message)||'Supabase client is not available.','Database Error');
      return;
    }

    const id=String(document.getElementById('projectId')?.value||'').trim();
    const name=String(document.getElementById('projectName')?.value||'').trim();
    const startDate=typeof dateOrNull==='function'
      ? dateOrNull(document.getElementById('projectStartDate')?.value)
      : (document.getElementById('projectStartDate')?.value||null);
    const dueDate=typeof dateOrNull==='function'
      ? dateOrNull(document.getElementById('projectDueDate')?.value)
      : (document.getElementById('projectDueDate')?.value||null);
    const actualDate=typeof dateOrNull==='function'
      ? dateOrNull(document.getElementById('projectActualDate')?.value)
      : (document.getElementById('projectActualDate')?.value||null);

    if(!name){
      validateRequiredFormFields(document.getElementById('projectForm'));
      return;
    }
    if(startDate && dueDate && dueDate<startDate){
      showToast('Planned Completion must be later than Start');
      return;
    }

    const owners=Array.from(document.querySelectorAll('.project-pic-checkbox'))
      .filter(cb=>cb.checked).map(cb=>cb.value).filter(Boolean);

    const existing=id
      ? (window.projectsList||[]).find(p=>String(p.id)===id)
      : null;

    const project={
      ...(existing||{}),
      id:id?Number(id):undefined,
      name,
      scope:existing?.scope||'Projects',
      detail:String(document.getElementById('projectDetail')?.value||'').trim(),
      owners,
      owner:owners.join(', '),
      startDate,
      dueDate,
      actualDate,
      gainDemand:String(document.getElementById('projectGainDemand')?.value||'').trim(),
      saving:v52Number(document.getElementById('projectSaving')?.value),
      actualSaving:v52Number(document.getElementById('projectActualSaving')?.value),
      // Keep project-level Detailed Status from both Create and Edit forms.
      detailedStatus:String(document.getElementById('projectDetailedStatus')?.value||'').trim(),
      note:String(document.getElementById('projectNote')?.value||'').trim(),
      status:existing?.status||'Not Started',
      progress:existing?.progress||0,
      priority:existing?.priority||3,
      hoursUsed:existing?.hoursUsed&&typeof existing.hoursUsed==='object'?existing.hoursUsed:{},
      phases:Array.isArray(existing?.phases)?existing.phases:[],
      tasks:Array.isArray(existing?.tasks)?existing.tasks:[],
      createdAt:existing?.createdAt||new Date().toISOString(),
      createdBy:existing?.createdBy||currentUser?.name||''
    };

    if(!v51Children(project).length){
      project.status=v51ProjectOnlyStatus(project);
    }else{
      project.status=typeof oldOverall==='function'
        ? oldOverall(project)
        : (existing?.status||'Not Started');
    }

    let __projectTeam; try{ __projectTeam=resolveTeamOrThrow(project); }catch(e){ showAppNotification(e.message,'Select a team'); return; }

    const payload={
      team:__projectTeam,
      name:String(project.name||'').trim(),
      owner:Array.isArray(project.owners)?project.owners.join(', '):(project.owner||null),
      owners:Array.isArray(project.owners)?project.owners:[],
      scope:project.scope||'Projects',
      detail:project.detail||'',
      status:project.status||'Not Started',
      progress:Math.max(0,Math.min(100,Number(project.progress)||0)),
      start_date:typeof dateOrNull==='function'?dateOrNull(project.startDate):project.startDate||null,
      due_date:typeof dateOrNull==='function'?dateOrNull(project.dueDate):project.dueDate||null,
      actual_date:typeof dateOrNull==='function'?dateOrNull(project.actualDate):project.actualDate||null,
      priority:Number(project.priority)||3,
      gain_demand:typeof numOrNull==='function'?numOrNull(project.gainDemand):null,
      saving:v52Number(project.saving),
      actual_saving:v52Number(project.actualSaving),
      note:project.note||null,
      hours_used:typeof buildProjectStorageHours==='function'
        ? buildProjectStorageHours(project)
        : {}
    };

    const form=document.getElementById('projectForm');
    const saveBtn=form?.querySelector('button[type="submit"]');
    const originalText=saveBtn?.innerHTML;
    if(saveBtn){
      saveBtn.disabled=true;
      saveBtn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
    }

    try{
      let result;
      if(id){
        result=await supabaseClient
          .from(SUPABASE_TABLES.Projects)
          .update(payload)
          .eq('id',Number(id))
          .select('*')
          .single();
      }else{
        result=await supabaseClient
          .from(SUPABASE_TABLES.Projects)
          .insert(payload)
          .select('*')
          .single();
      }
      if(result.error) throw result.error;

      const mapped=typeof mapDbProjectToApp==='function'
        ? mapDbProjectToApp(result.data)
        : project;
      mapped.phases=project.phases;
      mapped.tasks=project.tasks;
      mapped.hoursUsed=project.hoursUsed;
      // The returned DB mapping is authoritative for other fields, but make sure
      // the form value remains visible immediately after save as well.
      mapped.detailedStatus=String(project.detailedStatus||'');
      mapped.hoursUsed=typeof buildProjectStorageHours==='function'
        ? buildProjectStorageHours({...mapped,detailedStatus:mapped.detailedStatus})
        : project.hoursUsed;
      mapped.saving=v52Number(result.data?.saving);
      mapped.actualSaving=v52Number(result.data?.actual_saving);
      mapped.status=project.status;

      if(id){
        const index=(window.projectsList||[]).findIndex(p=>String(p.id)===id);
        if(index>=0) window.projectsList[index]=mapped;
        else window.projectsList.unshift(mapped);
      }else{
        window.projectsList.unshift(mapped);
      }

      if(window.sheetSyncSnapshots?.Projects){
        window.sheetSyncSnapshots.Projects=JSON.parse(JSON.stringify(window.projectsList));
      }

      closeProjectModal();
      v51RefreshProjectOnlyStatuses();
      renderProjectsTable();
      renderGanttChart();
      if(typeof updateDashboardCharts==='function') updateDashboardCharts();
      showAppNotification(id?'Project updated successfully.':'Project created successfully.');
    }catch(err){
      console.error('Fast project save error:',err);
      showAppNotification(`Unable to save project. ${err.message||err}`,'Save Error');
    }finally{
      if(saveBtn){
        saveBtn.disabled=false;
        if(originalText!==undefined) saveBtn.innerHTML=originalText;
      }
    }
  };

  /*
   * Re-rendering must use the project-only status rule and the saving roll-up.
   * Wrapping the renderer is intentionally light-weight; it does not perform
   * any database call.
   */
  const oldRender=window.renderProjectsTable;
  if(typeof oldRender==='function'&&!oldRender.__v51ProjectRules){
    const wrapped=function(){
      v51RefreshProjectOnlyStatuses();
      const result=oldRender.apply(this,arguments);
      requestAnimationFrame(()=>{
        v51RefreshProjectOnlyStatuses();
        const root=document.getElementById('projectsTableBody');
        if(root){
          root.querySelectorAll('.pm-owner-picker-btn').forEach(el=>{
            el.style.textAlign='center';
            el.style.justifyContent='center';
          });
        }
      });
      return result;
    };
    wrapped.__v51ProjectRules=true;
    window.renderProjectsTable=wrapped;
  }

  /* Also keep Gantt status consistent for project-only rows. */
  const oldGantt=window.renderGanttChart;
  if(typeof oldGantt==='function'&&!oldGantt.__v51ProjectRules){
    const wrapped=function(){
      v51RefreshProjectOnlyStatuses();
      return oldGantt.apply(this,arguments);
    };
    wrapped.__v51ProjectRules=true;
    window.renderGanttChart=wrapped;
  }

  v51RefreshProjectOnlyStatuses();
})();
