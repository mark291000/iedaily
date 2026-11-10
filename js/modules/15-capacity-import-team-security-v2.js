/* Category import rules:
   - Workload (Hour) is optional; blank defaults to 0.
   - Member / Team Admin uploads are always pinned to the signed-in user's team.
   - If a Team column exists for a non-Admin, every nonblank value must match the user's team.
   - Admin does not need a sidebar team selection; Team is read from each uploaded row.
   - Admin can import one or multiple teams in one file; each team is processed separately.
*/
window.handleCapacityImport = function (e) {
  const input = e?.target;
  const file = input?.files?.[0];
  if (!file) return;

  if (!currentUser) {
    showAppNotification('Please sign in before importing Category / Task Name.', 'Import Error');
    input.value = '';
    return;
  }
  if (currentUser.isReadOnly || currentUser.role === 'Viewer') {
    showAppNotification('Viewer access is read-only and cannot import data.', 'Import Error');
    input.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async evt => {
    try {
      const wb = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('The selected file does not contain a worksheet.');

      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
      if (!rawRows.length) throw new Error('The selected file is empty.');

      const admin = typeof isAdminSession === 'function'
        ? isAdminSession()
        : currentUser.role === 'Admin';
      const signedInTeam = String(currentUser.team || '').trim();

      if (!admin && !signedInTeam) {
        throw new Error('Your account is not assigned to a team. Contact an Admin before importing.');
      }

      const rows = rawRows.map((row, rowIndex) => {
        const normalized = {};
        Object.keys(row).forEach(k => {
          normalized[normalizeCapacityImportHeader(k)] = row[k];
        });

        const workloadRaw = normalized.workloadhour ?? normalized.workload ?? normalized.hours ?? '';
        const workloadText = String(workloadRaw ?? '').trim();
        const workload = workloadText === '' ? 0 : parseCapacityNumber(workloadRaw);
        const fileTeam = String(normalized.team ?? normalized.teamname ?? normalized.teamcode ?? '').trim();

        return {
          excelRow: rowIndex + 2,
          category: String(normalized.category ?? '').trim(),
          task: String(normalized.taskname ?? normalized.task ?? '').trim(),
          scope: String(normalized.scope ?? '').trim(),
          workload,
          workloadProvided: workloadText !== '',
          fileTeam,
          team: admin ? fileTeam : signedInTeam
        };
      });

      const errors = [];
      const seen = new Set();

      rows.forEach(r => {
        if (!r.category) errors.push(`Row ${r.excelRow}: Category is required.`);
        if (!r.task) errors.push(`Row ${r.excelRow}: Task Name is required.`);
        if (!r.scope) {
          errors.push(`Row ${r.excelRow}: Scope is required.`);
        }

        // Workload is optional. Only validate it when a value was supplied.
        if (r.workloadProvided && (!Number.isFinite(r.workload) || r.workload < 0)) {
          errors.push(`Row ${r.excelRow}: Workload (Hour), when provided, must be a number >= 0.`);
        }

        if (admin) {
          if (!r.team) {
            errors.push(`Row ${r.excelRow}: Team is required for Admin imports because no sidebar team selection is used.`);
          }
        } else if (r.fileTeam && normTeam(r.fileTeam) !== normTeam(signedInTeam)) {
          errors.push(`Row ${r.excelRow}: Team "${r.fileTeam}" does not match your signed-in team "${signedInTeam}".`);
        }

        const key = `${normTeam(r.team)}|||${r.category.toLowerCase()}|||${r.task.toLowerCase()}`;
        if (r.team && r.category && r.task) {
          if (seen.has(key)) errors.push(`Row ${r.excelRow}: Duplicate Team + Category + Task Name in the import file.`);
          seen.add(key);
        }
      });

      if (errors.length) {
        const shown = errors.slice(0, 15);
        const more = errors.length > 15 ? `\n...and ${errors.length - 15} more error(s).` : '';
        throw new Error(shown.join('\n') + more);
      }

      const groups = new Map();
      rows.forEach(r => {
        const team = admin ? r.team : signedInTeam;
        const key = normTeam(team);
        if (!groups.has(key)) groups.set(key, { team, rows: [] });
        groups.get(key).rows.push({
          category: r.category,
          task: r.task,
          scope: r.scope,
          workload: Number.isFinite(r.workload) ? r.workload : 0,
          team
        });
      });

      // Team-specific Scope list: add any new Scope values of the file to scope_options.
      for (const group of groups.values()) {
        try {
          const ex = await supabaseClient.from('scope_options').select('name,sort_order').eq('team', group.team);
          if (ex.error) throw ex.error;
          const have = new Set((ex.data || []).map(x => String(x.name || '').trim().toLowerCase()));
          let order = (ex.data || []).reduce((m, x) => Math.max(m, Number(x.sort_order) || 0), 0);
          const add = [...new Set(group.rows.map(r => String(r.scope || '').trim()).filter(Boolean))]
            .filter(n => !have.has(n.toLowerCase()))
            .map(name => ({ team: group.team, name, sort_order: (order += 10) }));
          if (add.length) {
            const ins = await supabaseClient.from('scope_options').insert(add);
            if (ins.error) throw ins.error;
          }
        } catch (scopeErr) {
          console.warn('Unable to update scope_options for team', group.team, scopeErr?.message || scopeErr);
        }
      }
      window.__scopeOptKey = null;
      let totalImported = 0;
      const completedTeams = [];
      for (const group of groups.values()) {
        const count = await importCapacityForTeam(group.team, group.rows);
        if (count === null) continue;
        totalImported += Number(count) || 0;
        completedTeams.push(group.team);
      }

      if (!completedTeams.length) return;
      renderCapacityTable();
      populateFilterOptions();
      restoreAdvancedTableFilters();
      showAppNotification(
        `${totalImported} Category / Task Name item(s) imported for: ${completedTeams.join(', ')}. Blank Workload values were saved as 0.`
      );
    } catch (err) {
      showAppNotification(err?.message || 'Capacity import failed.', 'Import Error');
    } finally {
      if (input) input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
};
