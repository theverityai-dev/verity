import pyarrow.parquet as pq, pyarrow as pa, pyarrow.compute as pc, os, re, urllib.request, sys
import pyarrow.fs as fs
OUTDIR=os.environ.get('PROSPECTS_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)),'out')); os.makedirs(OUTDIR, exist_ok=True)
_px=os.environ.get('HTTPS_PROXY')
s3=fs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options':_px} if _px else {}))
base='overturemaps-us-west-2/release/2026-10-21.0/theme=places/type=place/'
files=[f.path for f in s3.get_file_info(fs.FileSelector(base)) if f.path.endswith('.parquet')]
X0,X1,Y0,Y1=68.0,97.5,6.5,35.7
cols=['id','confidence','websites','emails','socials','phones','brand','addresses','names','operating_status','basic_category','taxonomy','bbox']
out=[]
for f in files:
    m=pq.ParquetFile(f, filesystem=s3); md=m.metadata
    names=[md.schema.column(i).path for i in range(md.num_columns)]
    ix={n:i for i,n in enumerate(names) if n.startswith('bbox.')}
    rgs=[]
    for g in range(md.num_row_groups):
        rg=md.row_group(g)
        xmin=rg.column(ix['bbox.xmin']).statistics.min; xmax=rg.column(ix['bbox.xmax']).statistics.max
        ymin=rg.column(ix['bbox.ymin']).statistics.min; ymax=rg.column(ix['bbox.ymax']).statistics.max
        if xmax>=X0 and xmin<=X1 and ymax>=Y0 and ymin<=Y1: rgs.append(g)
    print(f.split('/')[-1][:10], len(rgs), 'of', md.num_row_groups, flush=True)
    for g in rgs:
        t=m.read_row_group(g, columns=cols)
        b=t.column('bbox')
        x=pc.struct_field(b,'xmin'); y=pc.struct_field(b,'ymin')
        mask=pc.and_(pc.and_(pc.greater_equal(x,X0),pc.less_equal(x,X1)),pc.and_(pc.greater_equal(y,Y0),pc.less_equal(y,Y1)))
        t=t.filter(mask)
        if t.num_rows: out.append(t)
T=pa.concat_tables(out)
pq.write_table(T,os.path.join(OUTDIR,'india_bbox.parquet'))
print('rows',T.num_rows)
