// ===== Live clock + daypart =====
(function clock(){
  const el = document.getElementById('clock');
  const dp = document.getElementById('daypart');
  function tick(){
    const d = new Date();
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    if(el) el.textContent = `${hh}:${mm}:${ss}`;
    if(dp){
      const h = d.getHours();
      dp.textContent = h<12?'morning':h<17?'afternoon':'evening';
    }
  }
  tick(); setInterval(tick,1000);
})();

// ===== Sidebar navigation active state =====
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click',e=>{
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    item.classList.add('active');
    // close sidebar on mobile after selection
    document.getElementById('sidebar').classList.remove('open');
  });
});

// ===== Hamburger =====
const hb = document.getElementById('hamburger');
const sb = document.getElementById('sidebar');
hb.addEventListener('click',()=>sb.classList.toggle('open'));
document.addEventListener('click',e=>{
  if(window.innerWidth>760) return;
  if(!sb.contains(e.target) && !hb.contains(e.target)) sb.classList.remove('open');
});

// ===== Global search: filter products + announcements =====
const gs = document.getElementById('globalSearch');
if(gs){
  gs.addEventListener('input',e=>{
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.product').forEach(p=>{
      const t = p.querySelector('.p-name').textContent.toLowerCase();
      p.style.display = !q || t.includes(q) ? '' : 'none';
    });
    document.querySelectorAll('.ann').forEach(a=>{
      const t = a.textContent.toLowerCase();
      a.style.display = !q || t.includes(q) ? '' : 'none';
    });
  });
}

// ===== Map: zoom + search (legacy mock map — skipped when embedded map is used) =====
const canvas = document.getElementById('mapCanvas');
if (canvas) {
  let scale = 1;
  const apply = ()=>{ canvas.style.transform = `scale(${scale})`; };
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const zoomReset = document.getElementById('zoomReset');
  if (zoomIn)  zoomIn.onclick  = ()=>{ scale = Math.min(2, scale+0.15); apply(); };
  if (zoomOut) zoomOut.onclick = ()=>{ scale = Math.max(0.6, scale-0.15); apply(); };
  if (zoomReset) zoomReset.onclick = ()=>{ scale = 1; apply(); };

  const mapSearch = document.getElementById('mapSearch');
  if (mapSearch) {
    mapSearch.addEventListener('input',e=>{
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.bldg').forEach(b=>{
        const name = (b.dataset.name||'').toLowerCase();
        b.classList.toggle('highlight', !!q && name.includes(q));
      });
    });
  }

  document.querySelectorAll('.bldg').forEach(b=>{
    b.addEventListener('click',()=>{
      document.querySelectorAll('.bldg').forEach(x=>x.classList.remove('highlight'));
      b.classList.add('highlight');
    });
  });
}

// ===== Notifications: click to dismiss =====
document.getElementById('notifList').addEventListener('click',e=>{
  const li = e.target.closest('li');
  if(li){ li.style.transition='.25s'; li.style.opacity=0; li.style.transform='translateX(20px)';
    setTimeout(()=>li.remove(),250);
  }
});
document.querySelectorAll('.link-btn').forEach(b=>{
  if(b.textContent.trim()==='Mark all read'){
    b.addEventListener('click',()=>{
      document.querySelectorAll('#notifList li').forEach(li=>{
        li.style.transition='.25s';li.style.opacity=0;
        setTimeout(()=>li.remove(),250);
      });
    });
  }
});

// ===== Smooth in-page scroll for quick access =====
document.querySelectorAll('.qa-card, a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    const href = a.getAttribute('href');
    if(!href || !href.startsWith('#')) return;
    const target = document.querySelector(href);
    if(target){ e.preventDefault(); target.scrollIntoView({behavior:'smooth',block:'start'}); }
  });
});
