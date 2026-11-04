import sys, re, os, math, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pyarrow.parquet as pq, pandas as pd, numpy as np
from mapping import CAT2SLUG, REFINE, GENERIC
HERE=os.path.dirname(os.path.abspath(__file__))
OUTDIR=os.environ.get('PROSPECTS_OUT', os.path.join(HERE,'out')); os.makedirs(OUTDIR, exist_ok=True)
SLUGS=sorted(os.listdir(os.environ.get('VERITY_EXPLORE_BUSINESSES', os.path.join(HERE,'..','..','..','verity-explore','businesses'))))
import json
hubs=json.load(open(os.path.join(HERE,'hubs.json')))
pf=pq.ParquetFile(os.path.join(OUTDIR,'india_bbox.parquet'))
first=lambda a: a[0] if a is not None and len(a) else None
SOCIAL_HOSTS=('facebook.','instagram.','linkedin.','twitter.','x.com','youtube.','wa.me','whatsapp','justdial','google.','sites.google','blogspot','wix','indiamart','sulekha','zomato','swiggy','tripadvisor','booking.com','practo','linktr','business.site','goo.gl','bit.ly','t.me','magicpin','yelp','jsdl.in','tradeindia','makemytrip','goibibo','agoda','oyo','airbnb','lybrate')
def domain(u):
    if not isinstance(u,str) or not u: return None
    m=re.match(r'^(?:https?://)?(?:www\.)?([^/:?#]+)',u.strip().lower())
    return m.group(1) if m else None
FREE=('gmail.','yahoo.','hotmail.','rediffmail.','outlook.','live.','ymail.','icloud.','aol.','protonmail.')
def slug_of(cat,name):
    s=CAT2SLUG.get(cat)
    if s is None and cat in GENERIC:
        for rx,sl in GENERIC[cat]:
            if rx.search(name): s=sl; break
    if s is None: return None
    for base,rx,new in REFINE:
        if (s in base or cat in base) and rx.search(name): return new
    return s
parts=[]
for b in pf.iter_batches(batch_size=200000,columns=['id','confidence','websites','emails','socials','phones','brand','addresses','names','operating_status','taxonomy']):
    d=b.to_pandas()
    d['country']=d.addresses.map(lambda a: a[0]['country'] if a is not None and len(a) else None)
    d=d[(d.country=='IN') & (d.operating_status.fillna('open')=='open')]
    d['cat']=d.taxonomy.map(lambda x: x['primary'] if x else None)
    d['name']=d.names.map(lambda n: (n['primary'] or '').strip() if n else '')
    d=d[d.name.str.len()>=3]
    d['slug']=[slug_of(c,n) for c,n in zip(d.cat,d.name)]
    d=d[d.slug.notna()].copy()
    d['web']=d.websites.map(first); d['dom']=d.web.map(domain)
    d['own_site']=d.dom.map(lambda x: isinstance(x,str) and not any(h in x for h in SOCIAL_HOSTS))
    d.loc[~d.own_site,'dom']=None
    d['email']=d.emails.map(first)
    d['own_email']=d.email.map(lambda e: isinstance(e,str) and '@' in e and not any(f in e.split('@')[1] for f in FREE))
    d['phone']=d.phones.map(first)
    soc=d.socials.map(lambda s: list(s) if s is not None else [])
    d['instagram']=soc.map(lambda s: next((x for x in s if 'instagram' in x),None))
    d['linkedin']=soc.map(lambda s: next((x for x in s if 'linkedin' in x),None))
    d['facebook']=soc.map(lambda s: next((x for x in s if 'facebook' in x),None))
    a=d.addresses.map(first)
    d['address']=a.map(lambda x: x['freeform']); d['city']=a.map(lambda x: x['locality']); d['postcode']=a.map(lambda x: x['postcode']); d['region']=a.map(lambda x: x['region'])
    d['wikibrand']=d.brand.map(lambda b: bool(b and b.get('wikidata')))
    d=d.drop(columns=['websites','emails','socials','phones','brand','addresses','names','taxonomy','country','operating_status'])
    parts.append(d)
df=pd.concat(parts,ignore_index=True); del parts
print('mapped',len(df),flush=True)
for c in ['web','dom','email','phone','instagram','linkedin','facebook','address','city','postcode','region','name','cat','slug','id']:
    df[c]=df[c].astype(object).where(df[c].notna(), None)
df['contactable']=df.phone.notna()|df.email.notna()|df.own_site
df=df[df.contactable & ~df.wikibrand]
# group = one business (owner): own domain, else normalized name within state
norm0=lambda s: re.sub(r'[^a-z0-9]','',re.sub(r'\b(pvt|private|ltd|limited|llp|the)\b','',s.lower()))
norm=norm0
df['nkey']=df.name.map(norm)
dn=df[df.dom.notna()].groupby('dom').nkey.nunique()
shared=set(dn[dn>=3].index)
m=df.dom.isin(shared); print('brand/OEM domains',len(shared),'listings',int(m.sum()))
df.loc[m,'own_site']=False; df.loc[m,'dom']=None
df['gkey']=np.where(df.dom.notna(), 'd:'+df.dom.fillna(''), 'n:'+df.nkey+'|'+df.region.fillna(''))
g=df.groupby('gkey')
df['lockey']=df.postcode.fillna('')+'|'+df.address.fillna('').str.lower().str.replace(r'[^a-z0-9]','',regex=True).str[:18]
df['listings']=g.gkey.transform('size')
df['outlets']=df.groupby('gkey').lockey.transform('nunique').clip(lower=1)
df['pins']=df.groupby('gkey').postcode.transform('nunique').clip(lower=1)
df['outlets']=np.minimum(df.outlets,df.pins)
df['ncities']=g.city.transform('nunique')
# exclude enterprise-scale chains (>40 listings on one domain) - they run SAP/Oracle, not Verity's buyer
df=df[(df.listings<=60)&(df.outlets<=40)]
# --- exclude enterprises / multinationals / government: not Verity's owner-led buyer
MNC=re.compile(r'(evonik|mann-hummel|gfps|georgfischer|r-stahl|hul\.co\.in|unilever|nestle|itcportal|dabur|marico|britannia|parleproducts|amul|tafe\.com|piaggio|chilis|kryolan|guess|burberry|cushmanwakefield|lenovo|samsung|apple\.com|dell\.|hp\.com|sony|lg\.com|bosch|siemens|nordanglia|marriott|hilton|hyatt|accor|ihg\.|radisson|bestwestern|wyndham|tata|reliance|adani|mahindra|godrej|adityabirla|infosys|wipro|tcs\.|hcltech|jll\.|colliers|knightfrank|anarock|honda|hyundai|toyota|marutisuzuki|nexaexperience|heromotocorp|bajaj|tvsmotor|yamaha|suzuki|kia\.|mgmotor|ford\.|nissan|renault|skoda|volkswagen|mercedes|bmw|audi|apollo|fortis|maxhealthcare|manipal|narayanahealth|lalpath|srl\.|metropolis|thyrocare|kotak|hdfc|icici|sbi\.|axisbank|licindia|policybazaar|starbucks|mcdonalds|kfc|dominos|pizzahut|subway|burgerking|haldiram|titan|tanishq|kalyanjewellers|malabargold|joyalukkas|lenskart|croma|vijaysales|dmart|bigbazaar|spencers|moreretail|decathlon|ikea|pepperfry|urbanladder|nykaa|lakme|naturals\.in|vlcc|kaya|cult\.fit|goldsgym|anytimefitness|byjus|aakash|allen\.ac|fiitjee|unacademy|pw\.live|vedanta|sobha|prestigeconstructions|brigadegroup|dlf|lodhagroup|oberoirealty|hiranandani|puravankara|oyorooms|treebo|fabhotels|zostel|taj|itchotels|oberoihotels|lemontree|leela|vivanta|airtel|jio|vodafone|bsnl|amazon|flipkart|myntra|ajio|bata|liberty|woodland|puma|adidas|nike|reebok|skechers|levi|raymond|peterengland|allensolly|vanheusen|louisphilippe|manyavar|fabindia|westside|pantaloons|lifestylestores|shoppersstop|maxfashion|trends|zara|hm\.com|uniqlo|marksandspencer|benetton|tommy|calvinklein|jackjones|veromoda|onlyindia|biba|wforwoman|aurelia|caratlane|bluestone|pcjeweller|senco|orra|hugoboss|asianpaints|bergerpaints|nerolac|duluxx|kajaria|somany|jaquar|hindware|cera|havells|polycab|philips|panasonic|whirlpool|voltas|daikin|bluestar|carrier|haier|godrej|cipla|sunpharma|lupin|drreddys|zydus|glenmark|torrent|mankind|alkem|abbott|pfizer|novartis|gsk|sanofi|bayer|basf|dow\.|3m\.|abb\.|schneider|honeywell|emerson|cummins|caterpillar|ge\.com|kpmg|deloitte|pwc|ey\.com|accenture|capgemini|cognizant|ibm|oracle|microsoft|google|sap\.com|teamlease|quess|randstad|adecco|manpower|naukri|justdial|indiamart|makemytrip|yatra|thomascook|sotc|coxandkings|kotak|bajajfinserv|muthoot|manappuram|shriram|starhealth|nivabupa|careinsurance|hdfcergo|iciclombard|newindia|orientalinsurance|nationalinsurance|uiic|edudel|kvsangathan|navodaya|cbse)', re.I)
GOV=re.compile(r'(\.gov\.in|\.nic\.in|\.gov\b|\.mil\.in)',re.I)
GOVNAME=re.compile(r'\b(govt|government|kendriya vidyalaya|navodaya|municipal|corporation school|gbsss|ggsss|sbv|skv|rpvv|zilla parishad|panchayat|public works|police|army|air force|navy|railway|aiims|esic|cghs)\b',re.I)
LOCATOR=re.compile(r'//(stores|store|locate|locations|locator|outlets|branches|dealers)\.|/(en-in|en_in|in-en|en/in|in/en)\b|store-?locator',re.I)
FOREIGN_TLD=re.compile(r'\.(eu|de|fr|it|es|nl|ch|at|se|dk|no|fi|be|jp|cn|kr|uk|co\.uk|com\.au|ca|us|sg|ae)$',re.I)
bad=(df.dom.fillna('').str.contains(MNC)|df.email.fillna('').str.contains(MNC)|df.web.fillna('').str.contains(GOV)|df.email.fillna('').str.contains(GOV)
     |df.name.str.contains(GOVNAME)|df.web.fillna('').str.contains(LOCATOR)|df.dom.fillna('').str.contains(FOREIGN_TLD))
bad=bad|df.web.fillna('').str.contains(r'\.[a-z]+/(in|india|en|en-in|en\.html)/?$|/brands?[-/]',case=False,regex=True)
print('excluded enterprise/gov listings',int(bad.sum()))
df=df[~bad]
T1={'mumbai','delhi','new delhi','bengaluru','bangalore','hyderabad','chennai','kolkata','pune','ahmedabad','gurugram','gurgaon','noida','navi mumbai','thane','secunderabad','greater noida'}
T2=set('jaipur lucknow surat kochi ernakulam chandigarh indore coimbatore nagpur vadodara bhopal visakhapatnam ludhiana kanpur nashik mysuru mysore bhubaneswar thiruvananthapuram patna rajkot panaji margao dehradun guwahati mohali ghaziabad faridabad madurai vijayawada raipur ranchi amritsar jodhpur udaipur mangaluru mangalore kozhikode thrissur agra varanasi aurangabad jalandhar gwalior jabalpur hubli hubballi belagavi belgaum salem tiruchirappalli siliguri jammu kota ajmer meerut prayagraj allahabad zirakpur panchkula pimpri-chinchwad kalyan vasai-virar howrah tirupur tiruppur erode warangal guntur nellore'.split())
def tier(c):
    c=(c or '').lower().strip()
    return 1 if c in T1 else 2 if c in T2 else 3
df['tier']=df.city.map(tier)
ORG=re.compile(r'\b(pvt|private limited|ltd|llp|limited|group|enterprises|industries|& co|associates|international|solutions)\b',re.I)
df['orgname']=df.name.map(lambda n: bool(ORG.search(n)))
s=(df.own_site*3 + df.own_email*2 + (df.email.notna()&~df.own_email)*1 + df.phone.notna()*1
   + df.instagram.notna()*1 + df.linkedin.notna()*1.5 + df.facebook.notna()*0.5
   + df.orgname*1 + df.confidence.fillna(0).clip(0,1)*1.5
   + np.select([df.outlets>=5, df.outlets>=2],[3,2],0) + (df.ncities>=2)*1
   + df.tier.map({1:1.5,2:1.2,3:0}))
PUB=re.compile(r'\b(limited|ltd)\.?\s*$',re.I); PVT=re.compile(r'\b(pvt|private|p\))',re.I)
df['public_co']=df.name.map(lambda n: bool(PUB.search(n)) and not PVT.search(n))
s=s-df.public_co*3
df['score']=s.round(2)
# keep the best listing per business
df=df.sort_values(['score','confidence'],ascending=False)
best=df.drop_duplicates('gkey').copy()
best['web']=best.web.map(lambda u: re.sub(r'[?#].*$','',u) if isinstance(u,str) else u)
cities=df.groupby('gkey').city.agg(lambda c: ', '.join(sorted(set(x for x in c if x))[:6]))
best['outlet_cities']=best.gkey.map(cities)
print('businesses',len(best))
# minimum quality bar for "sophisticated": a real digital footprint
q=best[(best.own_site|best.own_email|best.linkedin.notna()|(best.outlets>=2)) & best.phone.notna()|(best.own_site&best.own_email)]
print('qualified',len(q))
pool=q.groupby('slug').size()
missing=[x for x in SLUGS if x not in pool.index]; print('no data for',missing)
# quota: every type gets coverage, weighted by sqrt(pool), total 20000
TOTAL=20000
w=np.sqrt(pool); quota=(w/w.sum()*TOTAL).round().astype(int).clip(lower=60)
quota=np.minimum(quota,pool)
while quota.sum()<TOTAL:
    room=pool-quota; room=room[room>0]
    if room.empty: break
    add=(np.sqrt(pool[room.index])/np.sqrt(pool[room.index]).sum()*(TOTAL-quota.sum())).apply(math.ceil)
    quota[room.index]=np.minimum(quota[room.index]+add,pool[room.index])
picked=[]
for sl,grp in q.groupby('slug'):
    picked.append(grp.nlargest(int(quota[sl]),'score'))
P=pd.concat(picked)
def dd(x):
    x=x.sort_values('score',ascending=False)
    x=x[~(x.phone.notna() & x.duplicated('phone'))]
    x=x[~(x.web.notna() & x.duplicated('web'))]
    return x
P=dd(P)
if len(P)<TOTAL:
    rest=dd(q[~q.gkey.isin(P.gkey)]); rest=rest[~rest.phone.isin(set(P.phone.dropna()))&~rest.web.isin(set(P.web.dropna()))]
    P=pd.concat([P,rest.nlargest(TOTAL-len(P),'score')])
P=P.nlargest(TOTAL,'score').reset_index(drop=True)
STATE={'AN':'Andaman & Nicobar','AP':'Andhra Pradesh','AR':'Arunachal Pradesh','AS':'Assam','BR':'Bihar','CH':'Chandigarh','CT':'Chhattisgarh','CG':'Chhattisgarh','DN':'Dadra & Nagar Haveli and Daman & Diu','DD':'Dadra & Nagar Haveli and Daman & Diu','DL':'Delhi','GA':'Goa','GJ':'Gujarat','HR':'Haryana','HP':'Himachal Pradesh','JK':'Jammu & Kashmir','JH':'Jharkhand','KA':'Karnataka','KL':'Kerala','LA':'Ladakh','LD':'Lakshadweep','MP':'Madhya Pradesh','MH':'Maharashtra','MN':'Manipur','ML':'Meghalaya','MZ':'Mizoram','NL':'Nagaland','OR':'Odisha','OD':'Odisha','PY':'Puducherry','PB':'Punjab','RJ':'Rajasthan','SK':'Sikkim','TN':'Tamil Nadu','TG':'Telangana','TS':'Telangana','TR':'Tripura','UP':'Uttar Pradesh','UT':'Uttarakhand','UK':'Uttarakhand','WB':'West Bengal'}
def pin_state(pc):
    pc=re.sub(r'\D','',pc or '')
    if len(pc)!=6: return None
    p2,p3=int(pc[:2]),int(pc[:3])
    if p3==403: return 'Goa'
    if p3==605 or p3==609: return 'Puducherry'
    if p3==737: return 'Sikkim'
    if p3==160: return 'Chandigarh'
    if p3 in (246,247,248,249,262,263): return 'Uttarakhand'
    if 814<=p3<=835: return 'Jharkhand'
    if p3 in (790,791,792): return 'Arunachal Pradesh'
    if p3 in (793,794): return 'Meghalaya'
    if p3==795: return 'Manipur'
    if p3==796: return 'Mizoram'
    if p3 in (797,798): return 'Nagaland'
    if p3==799: return 'Tripura'
    T={11:'Delhi',12:'Haryana',13:'Haryana',14:'Punjab',15:'Punjab',16:'Punjab',17:'Himachal Pradesh',18:'Jammu & Kashmir',19:'Jammu & Kashmir',30:'Rajasthan',31:'Rajasthan',32:'Rajasthan',33:'Rajasthan',34:'Rajasthan',36:'Gujarat',37:'Gujarat',38:'Gujarat',39:'Gujarat',40:'Maharashtra',41:'Maharashtra',42:'Maharashtra',43:'Maharashtra',44:'Maharashtra',45:'Madhya Pradesh',46:'Madhya Pradesh',47:'Madhya Pradesh',48:'Madhya Pradesh',49:'Chhattisgarh',50:'Telangana',51:'Andhra Pradesh',52:'Andhra Pradesh',53:'Andhra Pradesh',56:'Karnataka',57:'Karnataka',58:'Karnataka',59:'Karnataka',60:'Tamil Nadu',61:'Tamil Nadu',62:'Tamil Nadu',63:'Tamil Nadu',64:'Tamil Nadu',67:'Kerala',68:'Kerala',69:'Kerala',70:'West Bengal',71:'West Bengal',72:'West Bengal',73:'West Bengal',74:'West Bengal',75:'Odisha',76:'Odisha',77:'Odisha',78:'Assam',80:'Bihar',81:'Bihar',82:'Bihar',84:'Bihar',85:'Bihar'}
    if 20<=p2<=28: return 'Uttar Pradesh'
    return T.get(p2)
P['state']=[pin_state(pc) or STATE.get((r or '').upper(), r) for pc,r in zip(P.postcode,P.region)]
P['state']=P.state.replace({'Tamil Nādu':'Tamil Nadu'})
P['industry']=P.slug.map(lambda s: hubs.get(s,''))
def why(r):
    w=[]
    if r.outlets>=2: w.append(f'{r.outlets} locations' + (f' in {r.ncities} cities' if r.ncities>1 else ''))
    if r.own_site: w.append('own website')
    if r.own_email: w.append('company email domain')
    if r.linkedin: w.append('on LinkedIn')
    if r.instagram: w.append('active on Instagram')
    if r.orgname: w.append('registered-company name')
    if r.tier==1: w.append('metro city')
    elif r.tier==2: w.append('tier-2 city')
    return '; '.join(w)
P['why']=P.apply(why,axis=1)
P['fit']=pd.qcut(P.score.rank(method='first'),[0,.25,.75,1],labels=['C - nurture','B - good fit','A - best fit']).astype(str)
P.insert(0,'rank',range(1,len(P)+1))
P['business_type']=P.slug.str.replace('-',' ').str.capitalize()
P['tier']=P.tier.map({1:'Tier 1',2:'Tier 2',3:'Tier 3+'})
P['verity_page']='https://theverityai.xyz/businesses/'+P.slug+'/'
out=P[['rank','fit','score','name','industry','business_type','cat','outlets','outlet_cities','city','state','postcode','tier','address','phone','email','web','linkedin','instagram','facebook','why','verity_page','id']].rename(columns={'cat':'listing_category','web':'website','outlets':'locations','id':'overture_id'})
out.to_parquet(os.path.join(OUTDIR,'prospects.parquet'))
out.to_csv(os.path.join(OUTDIR,'verity_prospects_india_20000.csv'),index=False)
print(len(out)); print(out.fit.value_counts()); print(out.industry.value_counts()); print(out.tier.value_counts())
