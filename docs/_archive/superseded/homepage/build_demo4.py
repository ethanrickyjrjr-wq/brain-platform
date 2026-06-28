import re, json

C = {
    'midnight': '#0a1419', 'deep': '#0f1d24', 'slate': '#152832',
    'slate_hi': '#1c3340', 'teal': '#0a8078', 'mangrove': '#5bc97a',
    'coral': '#e08158', 'gold': '#d4b370', 'text': '#f0ede6',
    'text2': '#b8b4a8', 'text3': '#807e76',
}

PLACE_NAMES = {
    '33901':'Fort Myers (Downtown)','33903':'North Fort Myers','33904':'Fort Myers / Cape Coral',
    '33905':'East Fort Myers','33907':'Fort Myers','33908':'South Fort Myers',
    '33909':'Cape Coral North','33912':'Fort Myers East','33913':'Gateway',
    '33914':'Cape Coral SW','33916':'Fort Myers','33917':'North Fort Myers',
    '33919':'South Fort Myers','33920':'Alva','33921':'Boca Grande',
    '33922':'Matlacha','33924':'Captiva Island','33928':'Estero',
    '33931':'Fort Myers Beach','33936':'Lehigh Acres','33956':'St. James City',
    '33957':'Sanibel Island','33965':'Fort Myers','33966':'Fort Myers SW',
    '33967':'Fort Myers SW','33971':'Lehigh Acres W','33972':'Lehigh Acres',
    '33973':'Lehigh Acres','33974':'Lehigh Acres','33976':'Lehigh Acres E',
    '33990':'Cape Coral East','33991':'Cape Coral West','33993':'Cape Coral NW',
    '34101':'Naples','34102':'Naples (Downtown)','34103':'Naples Park Shore',
    '34104':'Naples East','34105':'Naples Central','34108':'Pelican Bay',
    '34109':'North Naples','34110':'North Naples','34112':'Naples South',
    '34113':'Lely Resort','34114':'Naples East','34116':'Golden Gate',
    '34117':'Golden Gate Estates','34119':'North Naples','34120':'Golden Gate Estates E',
    '34134':'Bonita Springs Beach','34135':'Bonita Springs','34137':'Copeland',
    '34138':'Marco Shores','34139':'Everglades City','34140':'Goodland',
    '34141':'Ochopee','34142':'Immokalee','34145':'Marco Island',
}
FLOOD = {'33901':2900,'33903':1800,'33904':3500,'33905':1200,'33907':1400,'33908':4200,'33909':1900,'33912':900,'33913':1200,'33914':5200,'33916':2100,'33917':1600,'33919':3800,'33920':600,'33921':14200,'33922':6400,'33924':18500,'33928':1800,'33931':30074,'33936':800,'33956':12800,'33957':22400,'33965':900,'33966':1100,'33967':1200,'33971':700,'33972':650,'33973':680,'33974':620,'33976':710,'33990':2800,'33991':3100,'33993':2200,'34101':4800,'34102':8500,'34103':5800,'34104':1400,'34105':2100,'34108':7200,'34109':2600,'34110':4100,'34112':3200,'34113':2800,'34114':1900,'34116':1100,'34117':900,'34119':900,'34120':700,'34134':3900,'34135':2400,'34137':1500,'34138':3200,'34139':11400,'34140':9200,'34141':2200,'34142':600,'34145':18900}
VALUE = {'33901':285000,'33903':310000,'33904':350000,'33905':295000,'33907':380000,'33908':410000,'33909':340000,'33912':420000,'33913':480000,'33914':395000,'33916':265000,'33917':295000,'33919':410000,'33920':340000,'33921':850000,'33922':375000,'33924':1200000,'33928':520000,'33931':680000,'33936':265000,'33956':420000,'33957':920000,'33965':310000,'33966':415000,'33967':390000,'33971':280000,'33972':270000,'33973':275000,'33974':260000,'33976':272000,'33990':345000,'33991':370000,'33993':355000,'34101':620000,'34102':985000,'34103':890000,'34104':420000,'34105':540000,'34108':1250000,'34109':720000,'34110':680000,'34112':480000,'34113':420000,'34114':380000,'34116':390000,'34117':440000,'34119':620000,'34120':520000,'34134':680000,'34135':590000,'34137':180000,'34138':310000,'34139':220000,'34140':380000,'34141':195000,'34142':185000,'34145':890000}
PERMITS = {'33901':28,'33903':45,'33904':62,'33905':38,'33907':51,'33908':89,'33909':245,'33912':142,'33913':356,'33914':178,'33916':19,'33917':34,'33919':67,'33920':82,'33921':6,'33922':41,'33924':3,'33928':168,'33931':44,'33936':198,'33956':12,'33957':8,'33965':22,'33966':95,'33967':113,'33971':267,'33972':231,'33973':312,'33974':189,'33976':204,'33990':198,'33991':287,'33993':341,'34101':31,'34102':18,'34103':24,'34104':76,'34105':58,'34108':42,'34109':134,'34110':187,'34112':89,'34113':112,'34114':143,'34116':167,'34117':198,'34119':215,'34120':423,'34134':122,'34135':145,'34137':4,'34138':9,'34139':7,'34140':11,'34141':3,'34142':88,'34145':56}

DATA_JS = json.dumps({
    'placeNames': PLACE_NAMES,
    'metrics': {
        'flood':   {'label':'Annual Flood Loss','sublabel':'FEMA NFIP avg annual loss per property','format':'currency','data':FLOOD,'low':600,'high':30074,'c0':C['slate'],'c1':C['gold'],'c2':C['coral']},
        'value':   {'label':'Median Home Value','sublabel':'Zillow ZHVI, April 2026','format':'currency','data':VALUE,'low':185000,'high':1250000,'c0':C['slate'],'c1':C['teal'],'c2':C['mangrove']},
        'permits': {'label':'New Permits 2024','sublabel':'Lee + Collier county building permits','format':'number','data':PERMITS,'low':3,'high':423,'c0':C['slate'],'c1':'#4a6fa8','c2':'#a0c4ff'},
    }
})

# Load + clean contractor SVG
with open(r'c:\Users\ethan\Downloads\Lee County and Collier County-01 (1).svg', 'r', encoding='utf-8', errors='replace') as f:
    svg = f.read()
svg = re.sub(r'id="_(\d{5})"', r'id="\1"', svg)
svg = re.sub(r'<style>.*?</style>', '', svg, flags=re.DOTALL)
def _tag_zip(m):
    tag = m.group(0)
    return tag[:-1] + ' class="zip-group">' if 'class=' not in tag else re.sub(r'class="', 'class="zip-group ', tag)
svg = re.sub(r'<g\b[^>]*\bid="\d{5}"[^>]*>', _tag_zip, svg)
svg = svg.replace('<svg ', '<svg id="contractor-map" ', 1)

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SWFL Data Gulf</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;background:MIDNIGHT;color:TEXT;min-height:100vh;-webkit-font-smoothing:antialiased}

nav{position:fixed;top:0;left:0;right:0;z-index:100;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 32px;background:rgba(10,20,25,.92);border-bottom:1px solid SLATE;backdrop-filter:blur(12px)}
.nav-logo{font-size:15px;font-weight:700;letter-spacing:.02em}
.nav-logo span{color:TEAL}
.nav-links{display:flex;gap:24px;align-items:center}
.nav-links a{font-size:13px;color:TEXT2;text-decoration:none;transition:color .15s}
.nav-links a:hover{color:TEXT}
.nav-cta{background:TEAL;color:TEXT;border:none;border-radius:6px;padding:7px 18px;font-size:13px;font-weight:600;cursor:pointer;transition:opacity .15s}
.nav-cta:hover{opacity:.85}

.hero{padding:96px 32px 36px;max-width:760px;margin:0 auto;text-align:center}
.hero-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500;color:TEAL;border:1px solid SLATE_HI;border-radius:100px;padding:4px 12px;margin-bottom:20px;letter-spacing:.04em;text-transform:uppercase}
.hero-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:TEAL;display:inline-block}
h1{font-size:clamp(32px,4.5vw,54px);font-weight:700;letter-spacing:-.03em;line-height:1.1;margin-bottom:14px}
h1 em{font-style:normal;color:TEAL}
.hero-sub{font-size:16px;color:TEXT2;line-height:1.65;max-width:520px;margin:0 auto 28px}

.search-wrap{max-width:560px;margin:0 auto 18px}
.search-bar{width:100%;display:flex;align-items:center;background:SLATE;border:1px solid SLATE_HI;border-radius:10px;padding:0 8px 0 16px;transition:border-color .2s,box-shadow .2s}
.search-bar:focus-within{border-color:TEAL;box-shadow:0 0 0 3px rgba(10,128,120,.15)}
.search-icon{color:TEXT3;flex-shrink:0;margin-right:10px}
.search-input{flex:1;background:transparent;border:none;outline:none;font-size:15px;font-family:inherit;color:TEXT;padding:13px 0}
.search-input::placeholder{color:TEXT3}
.search-btn{background:TEAL;border:none;border-radius:7px;padding:8px 18px;font-size:13px;font-weight:600;color:TEXT;cursor:pointer;white-space:nowrap;transition:opacity .15s}
.search-btn:hover{opacity:.85}

.filter-row{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.filter-pill{padding:6px 16px;border:1px solid SLATE_HI;border-radius:100px;font-size:13px;font-weight:500;color:TEXT2;background:transparent;cursor:pointer;transition:all .15s}
.filter-pill:hover{border-color:TEAL;color:TEXT}
.filter-pill.active{background:TEAL;border-color:TEAL;color:TEXT}

.map-section{margin-top:28px;border-top:1px solid SLATE}
.map-layout{display:grid;grid-template-columns:272px 1fr;height:calc(100vh - 310px);min-height:480px}

.data-rail{background:DEEP;border-right:1px solid SLATE;display:flex;flex-direction:column;overflow:hidden}
.rail-header{padding:14px 18px 12px;border-bottom:1px solid SLATE}
.rail-metric-name{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:TEXT3;margin-bottom:3px}
.rail-sublabel{font-size:11px;color:TEXT3;line-height:1.4}
.rail-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;gap:6px}
.rail-empty .e-icon{font-size:26px;opacity:.25;margin-bottom:4px}
.rail-empty .e-title{font-size:13px;font-weight:500;color:TEXT2}
.rail-empty .e-hint{font-size:12px;color:TEXT3;line-height:1.5}
.rail-detail{flex:1;display:flex;flex-direction:column;opacity:0;transition:opacity .2s;pointer-events:none;overflow-y:auto}
.rail-detail.visible{opacity:1;pointer-events:auto}
.zip-header{padding:18px 18px 14px;border-bottom:1px solid SLATE}
.zip-code-label{font-family:'JetBrains Mono',monospace;font-size:11px;color:TEXT3;letter-spacing:.06em;margin-bottom:3px}
.zip-place{font-size:17px;font-weight:600;line-height:1.2}
.zip-county{font-size:12px;color:TEXT3;margin-top:2px}
.metric-row{padding:13px 18px;border-bottom:1px solid SLATE;cursor:pointer;transition:background .1s}
.metric-row:hover{background:SLATE}
.metric-row.active-metric{background:rgba(10,128,120,.08);border-left:2px solid TEAL;padding-left:16px}
.metric-row-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:TEXT3;margin-bottom:4px}
.metric-row-value{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600}
.metric-row-rank{font-family:'JetBrains Mono',monospace;font-size:10px;color:TEXT3;margin-top:2px}
.mini-bar{height:3px;background:SLATE_HI;border-radius:2px;margin-top:7px;overflow:hidden}
.mini-bar-fill{height:100%;border-radius:2px;transition:width .4s ease}
.rail-footer{padding:14px 18px;font-size:10px;color:TEXT3;line-height:1.6;border-top:1px solid SLATE;margin-top:auto}

.map-canvas{position:relative;overflow:hidden;background:DEEP}
#contractor-map{width:100%;height:100%;display:block}
#contractor-map .zip-group{cursor:pointer}
#contractor-map .zip-group path{transition:fill .3s ease}
#contractor-map .zip-group:hover path{filter:brightness(1.22)}
#contractor-map .zip-group.selected path{stroke:TEXT !important;stroke-width:1.2px !important}
#contractor-map #the_rest_of_the_coast *{fill:DEEP !important;stroke:none !important;opacity:1 !important}
#contractor-map #Lee_county > *,#contractor-map #Collier_County > *{fill:none !important;stroke:rgba(240,237,230,.14) !important;stroke-width:.8px !important;opacity:1 !important}

.map-legend{position:absolute;bottom:18px;left:14px;background:rgba(15,29,36,.93);border:1px solid SLATE_HI;border-radius:8px;padding:11px 14px;backdrop-filter:blur(8px);min-width:190px}
.legend-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:TEXT3;margin-bottom:7px}
.legend-bar{height:5px;border-radius:3px;margin-bottom:4px}
.legend-labels{display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:10px;color:TEXT3}

#tooltip{position:absolute;background:rgba(10,20,25,.96);border:1px solid TEAL;border-radius:8px;padding:9px 13px;pointer-events:none;opacity:0;transition:opacity .1s;min-width:150px;z-index:20}
.tip-zip{font-family:'JetBrains Mono',monospace;font-size:10px;color:TEXT3;margin-bottom:1px}
.tip-place{font-size:13px;font-weight:500;margin-bottom:3px}
.tip-val{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:GOLD}

.stats-bar{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid SLATE;background:DEEP}
.stat-cell{padding:18px 22px;border-right:1px solid SLATE}
.stat-cell:last-child{border-right:none}
.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:TEXT3;margin-bottom:5px}
.stat-value{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:600}
.stat-sub{font-size:11px;color:TEXT3;margin-top:2px}
.stat-tag{display:inline-block;margin-top:5px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px;background:rgba(91,201,122,.1);color:MANGROVE}

/* ── Capabilities section ── */
.capabilities{padding:72px 32px 80px;background:MIDNIGHT;border-top:1px solid SLATE}
.cap-eyebrow{text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:TEAL;margin-bottom:14px}
.cap-headline{text-align:center;font-size:clamp(26px,3vw,38px);font-weight:700;letter-spacing:-.025em;line-height:1.15;margin-bottom:12px}
.cap-headline span{color:TEAL}
.cap-deck{text-align:center;font-size:15px;color:TEXT2;max-width:560px;margin:0 auto 56px;line-height:1.65}
.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:2px;max-width:1120px;margin:0 auto 64px;border:1px solid SLATE;border-radius:12px;overflow:hidden}
.cap-card{background:DEEP;padding:32px 28px;border-right:1px solid SLATE;position:relative}
.cap-card:last-child{border-right:none}
.cap-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.cap-card:nth-child(1)::before{background:TEAL}
.cap-card:nth-child(2)::before{background:MANGROVE}
.cap-card:nth-child(3)::before{background:GOLD}
.cap-card:nth-child(4)::before{background:CORAL}
.cap-icon{font-size:22px;margin-bottom:14px;display:block}
.cap-card-title{font-size:16px;font-weight:700;margin-bottom:8px;letter-spacing:-.01em}
.cap-card-desc{font-size:14px;color:TEXT2;line-height:1.65}

.comp-strip{max-width:1120px;margin:0 auto 56px;border:1px solid SLATE_HI;border-radius:12px;overflow:hidden;background:DEEP}
.comp-label{padding:14px 24px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:TEXT3;border-bottom:1px solid SLATE}
.comp-row{display:grid;grid-template-columns:repeat(4,1fr)}
.comp-item{padding:20px 24px;border-right:1px solid SLATE}
.comp-item:last-child{border-right:none}
.comp-name{font-size:13px;font-weight:600;margin-bottom:4px}
.comp-what{font-size:12px;color:TEXT3;margin-bottom:6px}
.comp-price{font-family:'JetBrains Mono',monospace;font-size:12px;color:CORAL}
.comp-us{background:rgba(10,128,120,.06)}
.comp-us .comp-name{color:TEAL}
.comp-price-us{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:MANGROVE}

.cap-cta-row{display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}
.cap-cta-row p{font-size:13px;color:TEXT3}
.cap-cta-row strong{color:TEXT2}
.cap-btn{display:inline-flex;align-items:center;gap:8px;background:TEAL;color:TEXT;border:none;border-radius:8px;padding:13px 28px;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;letter-spacing:.01em}
.cap-btn:hover{opacity:.85}
.cap-btn svg{flex-shrink:0}
</style>
</head>
<body>
<nav>
  <div class="nav-logo">SWFL <span>Data Gulf</span></div>
  <div class="nav-links">
    <a href="#">Markets</a><a href="#">Permits</a><a href="#">Flood Risk</a><a href="#">API</a>
    <button class="nav-cta">Get Access</button>
  </div>
</nav>

<div class="hero">
  <div class="hero-badge">Live Data &middot; Lee &amp; Collier Counties</div>
  <h1>Real Data.<br><em>Instant Answers.</em></h1>
  <p class="hero-sub">Ask any question about any ZIP code and get a cited answer in seconds. Tell AI what to build and it delivers the report&mdash;automatically, to your clients&rsquo; inboxes.</p>
  <div class="search-wrap">
    <div class="search-bar">
      <svg class="search-icon" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input class="search-input" type="text" placeholder="Search ZIP code, city, or neighborhood&hellip;" id="search-input">
      <button class="search-btn">Search</button>
    </div>
  </div>
  <div class="filter-row">
    <button class="filter-pill active" data-metric="flood">Flood Risk</button>
    <button class="filter-pill" data-metric="value">Home Value</button>
    <button class="filter-pill" data-metric="permits">New Permits</button>
  </div>
</div>

<div class="map-section">
  <div class="map-layout">
    <div class="data-rail">
      <div class="rail-header">
        <div class="rail-metric-name" id="rail-metric-name">Annual Flood Loss</div>
        <div class="rail-sublabel" id="rail-sublabel">FEMA NFIP avg annual loss per property</div>
      </div>
      <div class="rail-empty" id="rail-empty">
        <div class="e-icon">&#x1F4CD;</div>
        <div class="e-title">Select a ZIP code</div>
        <div class="e-hint">Click any area on the map to see detailed metrics</div>
      </div>
      <div class="rail-detail" id="rail-detail">
        <div class="zip-header">
          <div class="zip-code-label" id="rd-zipcode"></div>
          <div class="zip-place" id="rd-place"></div>
          <div class="zip-county" id="rd-county"></div>
        </div>
        <div class="metric-row" id="mrow-flood" data-metric="flood">
          <div class="metric-row-label">Annual Flood Loss</div>
          <div class="metric-row-value" id="mval-flood">&mdash;</div>
          <div class="metric-row-rank" id="mrank-flood"></div>
          <div class="mini-bar"><div class="mini-bar-fill" id="mbar-flood" style="background:CORAL"></div></div>
        </div>
        <div class="metric-row" id="mrow-value" data-metric="value">
          <div class="metric-row-label">Median Home Value</div>
          <div class="metric-row-value" id="mval-value">&mdash;</div>
          <div class="metric-row-rank" id="mrank-value"></div>
          <div class="mini-bar"><div class="mini-bar-fill" id="mbar-value" style="background:TEAL"></div></div>
        </div>
        <div class="metric-row" id="mrow-permits" data-metric="permits">
          <div class="metric-row-label">New Permits 2024</div>
          <div class="metric-row-value" id="mval-permits">&mdash;</div>
          <div class="metric-row-rank" id="mrank-permits"></div>
          <div class="mini-bar"><div class="mini-bar-fill" id="mbar-permits" style="background:#4a6fa8"></div></div>
        </div>
        <div class="rail-footer">Sources: FEMA NFIP &middot; Zillow ZHVI &middot; Lee/Collier County Permits &middot; Census TIGER 2020</div>
      </div>
    </div>
    <div class="map-canvas" id="map-canvas">
      SVG_PLACEHOLDER
      <div class="map-legend">
        <div class="legend-title" id="legend-title">Annual Flood Loss</div>
        <div class="legend-bar" id="legend-bar"></div>
        <div class="legend-labels"><span id="leg-low"></span><span id="leg-high"></span></div>
      </div>
      <div id="tooltip">
        <div class="tip-zip" id="tip-zip"></div>
        <div class="tip-place" id="tip-place"></div>
        <div class="tip-val" id="tip-val"></div>
      </div>
    </div>
  </div>
  <div class="stats-bar">
    <div class="stat-cell"><div class="stat-label">Highest Flood Risk</div><div class="stat-value">33931</div><div class="stat-sub">Fort Myers Beach</div><div class="stat-tag">$30,074 AAL</div></div>
    <div class="stat-cell"><div class="stat-label">Highest Home Value</div><div class="stat-value">34108</div><div class="stat-sub">Pelican Bay, Naples</div><div class="stat-tag">$1.25M median</div></div>
    <div class="stat-cell"><div class="stat-label">Most Active Permits</div><div class="stat-value">34120</div><div class="stat-sub">Golden Gate Estates E</div><div class="stat-tag">423 permits</div></div>
    <div class="stat-cell"><div class="stat-label">ZIPs Covered</div><div class="stat-value">57</div><div class="stat-sub">Lee + Collier Counties</div><div class="stat-tag">Updated daily</div></div>
  </div>
</div>

<!-- ── Capabilities ── -->
<section class="capabilities">
  <div class="cap-eyebrow">What you can do</div>
  <h2 class="cap-headline">Tell it what you want. <span>It happens.</span></h2>
  <p class="cap-deck">No workflow builders. No drip sequence setup. No $499/mo CRM. Just say what you need.</p>

  <div class="cap-grid">

    <div class="cap-card">
      <span class="cap-icon">&#x26A1;</span>
      <div class="cap-card-title">Ask anything. Get the answer.</div>
      <div class="cap-card-desc">Any market question, any ZIP. Real numbers, right now.</div>
    </div>

    <div class="cap-card">
      <span class="cap-icon">&#x1F4CB;</span>
      <div class="cap-card-title">Describe it. AI builds it.</div>
      <div class="cap-card-desc">Market summary, flood analysis, investment memo. Say what you need&mdash;it&rsquo;s ready.</div>
    </div>

    <div class="cap-card">
      <span class="cap-icon">&#x1F4C2;</span>
      <div class="cap-card-title">Add clients. AI tracks everything.</div>
      <div class="cap-card-desc">Drop in properties or clients. AI monitors what changes and tells you first.</div>
    </div>

    <div class="cap-card">
      <span class="cap-icon">&#x1F551;</span>
      <div class="cap-card-title">Scheduled. Automatic. Just say when.</div>
      <div class="cap-card-desc">&ldquo;Email my clients every month.&rdquo; Done. AI writes it from live data, personalizes it for each client, and sends on schedule&mdash;forever. No workflow to build.</div>
    </div>

  </div>

  <!-- Competitor comparison strip -->
  <div class="comp-strip">
    <div class="comp-label">What everyone else charges for this</div>
    <div class="comp-row">
      <div class="comp-item">
        <div class="comp-name">Mailchimp</div>
        <div class="comp-what">Email automation</div>
        <div class="comp-price">$68+/mo &mdash; build it yourself</div>
      </div>
      <div class="comp-item">
        <div class="comp-name">Constant Contact</div>
        <div class="comp-what">Scheduled campaigns</div>
        <div class="comp-price">$68/mo &mdash; manual workflow setup</div>
      </div>
      <div class="comp-item">
        <div class="comp-name">Follow Up Boss</div>
        <div class="comp-what">AI + automation for RE teams</div>
        <div class="comp-price">$499/mo for 10 users</div>
      </div>
      <div class="comp-item comp-us">
        <div class="comp-name">SWFL Data Gulf</div>
        <div class="comp-what">All of it &mdash; just ask</div>
        <div class="comp-price-us">Included.</div>
      </div>
    </div>
  </div>

  <div class="cap-cta-row">
    <button class="cap-btn">
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Get Early Access
    </button>
    <p><strong>Realtors, investors, and property managers</strong> in Southwest Florida &mdash; built for how you actually work.</p>
  </div>
</section>

<script>
const DATA = DATA_JS_PLACEHOLDER;
let activeMetric='flood',selectedZip=null;
function lerp(a,b,t){return a+(b-a)*Math.max(0,Math.min(1,t))}
function hexToRgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function lerpColor(c1,c2,t){const[r1,g1,b1]=hexToRgb(c1),[r2,g2,b2]=hexToRgb(c2);return`rgb(${Math.round(lerp(r1,r2,t))},${Math.round(lerp(g1,g2,t))},${Math.round(lerp(b1,b2,t))})`}
function getColor(zip,metric){
  const m=DATA.metrics[metric],val=m.data[zip];
  if(val===undefined)return'#152832';
  const t=(val-m.low)/(m.high-m.low);
  return t<0.5?lerpColor(m.c0,m.c1,t*2):lerpColor(m.c1,m.c2,(t-0.5)*2);
}
function fmt(val,format){
  if(format==='currency'){if(val>=1000000)return'$'+(val/1000000).toFixed(2)+'M';if(val>=1000)return'$'+Math.round(val/1000)+'K';return'$'+val.toLocaleString()}
  return val.toLocaleString()
}
function rankOf(zip,metric){
  const m=DATA.metrics[metric],sorted=Object.entries(m.data).sort((a,b)=>b[1]-a[1]),i=sorted.findIndex(([z])=>z===zip);
  return i===-1?null:{pos:i+1,total:sorted.length}
}
function county(zip){return parseInt(zip)>=34100?'Collier County':'Lee County'}
function applyMetric(metric){
  activeMetric=metric;
  const m=DATA.metrics[metric];
  document.querySelectorAll('#contractor-map .zip-group').forEach(g=>{
    const color=getColor(g.id,metric);
    g.querySelectorAll('path').forEach(p=>{p.style.fill=color;p.style.stroke='#0a1419';p.style.strokeWidth='.3px';p.style.opacity='1'});
  });
  document.getElementById('legend-title').textContent=m.label;
  document.getElementById('leg-low').textContent=fmt(m.low,m.format);
  document.getElementById('leg-high').textContent=fmt(m.high,m.format);
  document.getElementById('legend-bar').style.background=`linear-gradient(to right,${m.c0},${m.c1},${m.c2})`;
  document.getElementById('rail-metric-name').textContent=m.label;
  document.getElementById('rail-sublabel').textContent=m.sublabel;
  document.querySelectorAll('.filter-pill').forEach(p=>p.classList.toggle('active',p.dataset.metric===metric));
  ['flood','value','permits'].forEach(k=>document.getElementById('mrow-'+k).classList.toggle('active-metric',k===metric));
  if(selectedZip)fillRail(selectedZip);
}
function fillRail(zip){
  selectedZip=zip;
  document.getElementById('rd-zipcode').textContent=zip;
  document.getElementById('rd-place').textContent=DATA.placeNames[zip]||zip;
  document.getElementById('rd-county').textContent=county(zip);
  ['flood','value','permits'].forEach(k=>{
    const m=DATA.metrics[k],val=m.data[zip],r=rankOf(zip,k);
    document.getElementById('mval-'+k).textContent=val!==undefined?fmt(val,m.format):'N/A';
    document.getElementById('mrank-'+k).textContent=r?`#${r.pos} of ${r.total} ZIPs`:'';
    document.getElementById('mbar-'+k).style.width=val!==undefined?Math.max(3,((val-m.low)/(m.high-m.low))*100)+'%':'0%';
  });
  document.getElementById('rail-empty').style.display='none';
  document.getElementById('rail-detail').classList.add('visible');
}
const tip=document.getElementById('tooltip'),canvas=document.getElementById('map-canvas');
function showTip(e,zip){
  const m=DATA.metrics[activeMetric],val=m.data[zip];
  document.getElementById('tip-zip').textContent=zip;
  document.getElementById('tip-place').textContent=DATA.placeNames[zip]||'';
  document.getElementById('tip-val').textContent=val!==undefined?fmt(val,m.format):'N/A';
  tip.style.opacity='1';moveTip(e);
}
function moveTip(e){
  const r=canvas.getBoundingClientRect();
  let x=e.clientX-r.left+14,y=e.clientY-r.top+14;
  if(x+180>r.width)x-=200;if(y+80>r.height)y-=90;
  tip.style.left=x+'px';tip.style.top=y+'px';
}
document.querySelectorAll('#contractor-map .zip-group').forEach(g=>{
  g.addEventListener('mouseenter',e=>showTip(e,g.id));
  g.addEventListener('mousemove',e=>moveTip(e));
  g.addEventListener('mouseleave',()=>tip.style.opacity='0');
  g.addEventListener('click',()=>{
    document.querySelectorAll('#contractor-map .zip-group.selected').forEach(s=>s.classList.remove('selected'));
    g.classList.add('selected');fillRail(g.id);
  });
});
document.querySelectorAll('.filter-pill').forEach(b=>b.addEventListener('click',()=>applyMetric(b.dataset.metric)));
document.querySelectorAll('.metric-row').forEach(r=>r.addEventListener('click',()=>applyMetric(r.dataset.metric)));
document.getElementById('search-input').addEventListener('keydown',e=>{
  if(e.key==='Enter'){const g=document.getElementById(e.target.value.trim());if(g){document.querySelectorAll('#contractor-map .zip-group.selected').forEach(s=>s.classList.remove('selected'));g.classList.add('selected');fillRail(g.id)}}
});
applyMetric('flood');
</script>
</body>
</html>"""

# Substitute color tokens
for k, v in [('MIDNIGHT', C['midnight']), ('DEEP', C['deep']), ('SLATE_HI', C['slate_hi']),
             ('SLATE', C['slate']), ('TEAL', C['teal']), ('MANGROVE', C['mangrove']),
             ('CORAL', C['coral']), ('GOLD', C['gold']), ('TEXT3', C['text3']),
             ('TEXT2', C['text2']), ('TEXT', C['text'])]:
    HTML = HTML.replace(k, v)

HTML = HTML.replace('SVG_PLACEHOLDER', svg)
HTML = HTML.replace('DATA_JS_PLACEHOLDER', DATA_JS)

out = r'c:\Users\ethan\Downloads\swfl-demo-wip.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write(HTML)
print(f"Written: {len(HTML)//1024}KB -> {out}")
