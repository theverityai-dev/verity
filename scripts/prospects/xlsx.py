import pandas as pd, os
OUTDIR=os.environ.get('PROSPECTS_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)),'out'))
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
p=pd.read_parquet(os.path.join(OUTDIR,'prospects.parquet'))
p['phone']=p.phone.astype(str).where(p.phone.notna(),'')
cols=['rank','fit','score','name','industry','business_type','locations','outlet_cities','city','state','postcode','tier','phone','email','website','instagram','facebook','linkedin','address','why','listing_category','verity_page','overture_id']
hdr={'rank':'Rank','fit':'Fit','score':'Score','name':'Business name','industry':'Verity industry','business_type':'Verity business type','locations':'Locations (distinct)','outlet_cities':'Cities seen','city':'City','state':'State','postcode':'PIN','tier':'City tier','phone':'Phone','email':'Email','website':'Website','instagram':'Instagram','facebook':'Facebook','linkedin':'LinkedIn','address':'Address','why':'Why they fit','listing_category':'Listing category','verity_page':'Verity page to send','overture_id':'Source record (Overture)'}
p=p[cols]
OUT=os.path.join(OUTDIR,'verity_prospects_india_20000.xlsx')
wb=Workbook(); ws=wb.active; ws.title='Read me'
head=Font(bold=True,color='FFFFFF'); fill=PatternFill('solid',fgColor='1C1C1E')
notes=[
 ['Verity prospect list: 20,000 Indian businesses'],[''],
 ['Source','Overture Maps Places, release 2026-10-21 (open data: CDLA-Permissive-2.0 / ODbL). Public business listings only; no personal data was bought or scraped.'],
 ['Universe','4.67M Indian places → 2.69M matched to Verity\'s 123 business types → 1.87M distinct businesses → 690k passed the quality bar → top 20,000 kept'],
 ['Quality bar','Open, has a phone, and has a digital footprint: own website domain, company email, or 2+ locations'],
 ['Excluded','Multinationals and big national chains (they run SAP/Oracle), store-locator pages of global brands, foreign-domain subsidiaries, government bodies, places of worship, banks, ATMs. Chains with more than 40 listings are dropped.'],
 ['Score','Own website +3, company email +2 (free email +1), phone +1, Instagram +1, LinkedIn +1.5, Facebook +0.5, registered-company name +1, 2-4 locations +2, 5+ locations +3, more than one city +1, metro +1.5, tier-2 city +1.2, listing confidence up to +1.5; public "Limited" company -3'],
 ['Fit','A = top 25% by score, B = middle 50%, C = bottom 25%. Every row passed the quality bar; C means nurture, not reject.'],
 ['Coverage','Every Verity business type gets a quota weighted by the square root of its pool (minimum 60 where the pool allows). Online marketplaces has no matching listings.'],
 ['Before calling','Contacts come from public listings and may be out of date; verify each before outreach. Check numbers against the DND/NCPR registry before cold calls or SMS (TRAI rules), and honour opt-outs under the DPDP Act 2023.'],
 [''],['Prospects by industry'],
]
for r in notes: ws.append(r)
ws['A1'].font=Font(bold=True,size=14)
for i in range(3,11): ws.cell(i,1).font=Font(bold=True)
ws.column_dimensions['A'].width=18; ws.column_dimensions['B'].width=120
for c in ws['B']: c.alignment=Alignment(wrap_text=True,vertical='top')
summ=p.groupby('industry').agg(prospects=('rank','size'),best_fit=('fit',lambda f:(f=='A - best fit').sum()),multi_location=('locations',lambda l:(l>=2).sum()),with_email=('email',lambda e:e.notna().sum())).sort_values('prospects',ascending=False)
ws.append(['Industry','Prospects','A - best fit','2+ locations','With email'])
for c in ws[ws.max_row]: c.font=Font(bold=True)
for ind,r in summ.iterrows(): ws.append([ind,int(r.prospects),int(r.best_fit),int(r.multi_location),int(r.with_email)])
ws.append(['Total',len(p),int((p.fit=='A - best fit').sum()),int((p.locations>=2).sum()),int(p.email.notna().sum())])
ws.append(['']); ws.append(['Prospects by business type'])
ws.append(['Business type','Prospects','Industry'])
for c in ws[ws.max_row]: c.font=Font(bold=True)
bt=p.groupby(['business_type','industry']).size().reset_index(name='n').sort_values('n',ascending=False)
for _,r in bt.iterrows(): ws.append([r.business_type,int(r.n),r.industry])
widths={'Rank':7,'Fit':13,'Score':7,'Business name':38,'Verity industry':24,'Verity business type':24,'Locations (distinct)':10,'Cities seen':28,'City':16,'State':16,'PIN':9,'City tier':9,'Phone':16,'Email':30,'Website':36,'Instagram':30,'Facebook':30,'LinkedIn':28,'Address':40,'Why they fit':50,'Listing category':22,'Verity page to send':40,'Source record (Overture)':38}
def sheet(title,d):
    w=wb.create_sheet(title[:31]); h=[hdr[c] for c in cols]; w.append(h)
    for c in w[1]: c.font=head; c.fill=fill
    for row in d.itertuples(index=False): w.append([None if (isinstance(v,float) and pd.isna(v)) else v for v in row])
    for i,x in enumerate(h,1): w.column_dimensions[get_column_letter(i)].width=widths[x]
    w.freeze_panes='E2'; w.auto_filter.ref=w.dimensions
sheet('All 20,000',p)
for ind in summ.index: sheet(ind.replace('&','and'),p[p.industry==ind])
wb.save(OUT); print(OUT)
p.to_csv(os.path.join(OUTDIR,'verity_prospects_india_20000.csv'),index=False); print('csv ok')
