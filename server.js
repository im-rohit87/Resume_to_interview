require('dotenv').config();
const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),
multer=require('multer'),nodemailer=require('nodemailer'),fs=require('fs'),path=require('path'),crypto=require('crypto'),pdf=require('pdf-parse');
const Anthropic=require('@anthropic-ai/sdk');
const {JWT_SECRET='change-me',PORT=3000}=process.env;
const APP_URL=process.env.APP_URL||`http://localhost:${PORT}`;
const uploadDir = '/tmp/uploads';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
const db=new Database('data.db');
db.exec(`create table if not exists users(id integer primary key autoincrement,email text unique,name text,role text,pw text,
status text,score integer,sched text,resume_text text,questions text,transcript text,ai_score integer,ai_feedback text,flags integer default 0,video text)`);
const ae=process.env.ADMIN_EMAIL||'admin@company.com';
if(!db.prepare('select 1 from users where email=?').get(ae))
 db.prepare('insert into users(email,name,role,pw) values(?,?,?,?)').run(ae,'Admin','admin',bcrypt.hashSync(process.env.ADMIN_PASSWORD||'Admin@123',10));

/* ---- email (SMTP or console fallback) ---- */
const tx=process.env.SMTP_HOST?nodemailer.createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
async function mail(to,subject,text){
 if(!tx){console.log(`\n[MAIL to ${to}] ${subject}\n${text}\n`);return false}
 await tx.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to,subject,text});return true;
}
/* ---- Claude ---- */
const claude=process.env.ANTHROPIC_API_KEY?new Anthropic():null;
async function ai(prompt,max=1200){
 if(!claude)return null;
 const r=await claude.messages.create({model:process.env.CLAUDE_MODEL||'claude-sonnet-5-5',max_tokens:max,messages:[{role:'user',content:prompt}]});
 return r.content.map(b=>b.text||'').join('');
}
const parse=s=>JSON.parse(s.replace(/```json|```/g,'').trim());
const DEFAULT_Q=["Introduce yourself and your background.","Describe your most challenging project and your role.","How do you handle tight deadlines?","Explain a technical concept you know well to a beginner.","Why do you want this role?"];
const TEST=[["What is the time complexity of binary search?",["O(n)","O(log n)","O(n log n)","O(1)"],1],
["Which data structure uses FIFO order?",["Stack","Queue","Tree","Heap"],1],
["Which HTTP method is idempotent by design?",["POST","PUT","PATCH","CONNECT"],1],
["SQL keyword to remove duplicate rows in a result?",["UNIQUE","DISTINCT","DELETE","GROUP"],1],
["Output of 2**3 in Python?",["6","8","9","5"],1],
["Which is NOT a JavaScript primitive?",["string","number","object","boolean"],2],
["Git command to combine branches?",["git merge","git init","git stash","git blame"],0],
["Worst-case time complexity of quicksort?",["O(n log n)","O(n)","O(n²)","O(log n)"],2],
["What does REST stand for?",["Representational State Transfer","Remote Execution Service Tool","Reliable Endpoint Stream Type","None"],0],
["Which OSI layer handles routing?",["Transport","Network","Session","Data link"],1]];

const app=express();app.use(express.json());app.use(express.static('public'));
const up = multer({
    dest: uploadDir,
    limits: {
        fileSize: 500 * 1024 * 1024
    }
});
const auth=role=>(req,res,next)=>{try{const t=(req.headers.authorization||'').slice(7)||req.query.t;
 const u=jwt.verify(t,JWT_SECRET);if(role&&u.role!==role)throw 0;req.u=u;next()}catch{res.status(401).json({error:'Unauthorized'})}};
const get=id=>db.prepare('select * from users where id=?').get(id);
const wrap=f=>(req,res)=>Promise.resolve(f(req,res)).catch(e=>{console.error(e);res.status(500).json({error:e.message})});

app.post('/api/login',(req,res)=>{
 const u=db.prepare('select * from users where email=?').get((req.body.email||'').trim().toLowerCase());
 if(!u||!bcrypt.compareSync(req.body.password||'',u.pw))return res.status(401).json({error:'Invalid email or password'});
 res.json({token:jwt.sign({id:u.id,role:u.role},JWT_SECRET,{expiresIn:'12h'}),role:u.role});
});

/* ---------------- ADMIN ---------------- */
app.get('/api/admin/candidates',auth('admin'),(req,res)=>res.json(db.prepare(
 `select id,email,name,status,score,sched,ai_score,ai_feedback,flags,transcript,video is not null has_video from users where role='candidate' order by id desc`).all()));

app.post('/api/admin/candidates',auth('admin'),wrap(async(req,res)=>{
 const name=(req.body.name||'').trim(),email=(req.body.email||'').trim().toLowerCase();
 if(!name||!email)return res.status(400).json({error:'Name and email required'});
 if(db.prepare('select 1 from users where email=?').get(email))return res.status(400).json({error:'Email already exists'});
 const pw=crypto.randomBytes(5).toString('hex');
 db.prepare(`insert into users(email,name,role,pw,status) values(?,?,'candidate',?,'invited')`).run(email,name,bcrypt.hashSync(pw,10));
 const emailed=await mail(email,'Your AI Interview Login',`Hi ${name},\n\nYou have been invited to our AI interview process.\n\nLogin link: ${APP_URL}\nEmail: ${email}\nPassword: ${pw}\n\nRound 1 is a 20-mark test. Score above 15 to qualify for the next round.`);
 res.json({emailed,password:emailed?undefined:pw});
}));

app.post('/api/admin/candidates/:id/schedule',auth('admin'),wrap(async(req,res)=>{
 const c=get(req.params.id);
 if(!c||!['selected','scheduled'].includes(c.status))return res.status(400).json({error:'Candidate not eligible for scheduling'});
 db.prepare(`update users set sched=?,status='scheduled' where id=?`).run(req.body.when,c.id);
 await mail(c.email,'Interview Scheduled',`Hi ${c.name},\n\nCongratulations on clearing Round 1! Your AI video interview is scheduled for ${req.body.when.replace('T',' ')}.\nLogin: ${APP_URL}\nKeep your resume, camera and microphone ready.`);
 res.json({ok:true});
}));

app.get('/api/admin/candidates/:id/video',auth('admin'),(req,res)=>{
 const c=get(req.params.id);if(!c||!c.video)return res.sendStatus(404);
 res.sendFile(path.resolve(c.video)); // supports Range requests for seeking
});

app.post('/api/admin/candidates/:id/offer',auth('admin'),wrap(async(req,res)=>{
 const c=get(req.params.id);
 if(!c||c.status!=='interviewed')return res.status(400).json({error:'Candidate has not completed the interview'});
 const co=process.env.COMPANY_NAME||'Our Company';
 const letter=(await ai(`Write a professional, warm offer letter (plain text, under 200 words) for ${c.name} from ${co}. Mention they performed well in the online test and AI interview. Leave salary and joining date as [To be confirmed]. Sign as "HR Team, ${co}".`))
  ||`Dear ${c.name},\n\nCongratulations! We are pleased to offer you a position at ${co}. Salary and joining date: [To be confirmed].\n\nRegards,\nHR Team, ${co}`;
 const sent=await mail(c.email,`Offer Letter - ${co}`,letter);
 db.prepare(`update users set status='offered' where id=?`).run(c.id);
 res.json({sent,letter});
}));

/* ---------------- CANDIDATE ---------------- */
app.get('/api/me',auth('candidate'),(req,res)=>{const c=get(req.u.id);res.json({name:c.name,status:c.status,score:c.score,sched:c.sched})});

app.get('/api/test',auth('candidate'),(req,res)=>{
 if(get(req.u.id).status!=='invited')return res.status(400).json({error:'Test already attempted'});
 res.json(TEST.map(q=>({q:q[0],options:q[1]}))); // answers never leave the server
});
app.post('/api/test',auth('candidate'),(req,res)=>{
 const c=get(req.u.id);if(c.status!=='invited')return res.status(400).json({error:'Test already attempted'});
 const a=req.body.answers||[];const score=TEST.reduce((s,q,i)=>s+(a[i]===q[2]?2:0),0);
 db.prepare('update users set score=?,status=? where id=?').run(score,score>15?'selected':'failed',c.id);
 res.json({score});
});

app.post('/api/interview/start',auth('candidate'),up.single('resume'),wrap(async(req,res)=>{
 const c=get(req.u.id);
 if(c.status!=='scheduled')return res.status(400).json({error:'No interview scheduled'});
 if(new Date(c.sched)>new Date())return res.status(400).json({error:'Interview has not opened yet'});
 if(!req.file)return res.status(400).json({error:'Resume required'});
 let text='';
 try{text=/\.pdf$/i.test(req.file.originalname)?(await pdf(fs.readFileSync(req.file.path))).text:fs.readFileSync(req.file.path,'utf8')}catch{}
 let qs;
 try{qs=parse(await ai(`Generate 5 interview questions tailored to this resume (mix technical and behavioural). Return ONLY a JSON array of strings.\n\nResume:\n${text.slice(0,6000)}`))}catch{}
 if(!Array.isArray(qs)||!qs.length)qs=DEFAULT_Q;
 db.prepare('update users set resume_text=?,questions=? where id=?').run(text.slice(0,6000),JSON.stringify(qs),c.id);
 res.json({questions:qs});
}));

app.post('/api/interview/finish',auth('candidate'),up.single('video'),wrap(async(req,res)=>{
 const c=get(req.u.id);
 if(c.status!=='scheduled'||!c.questions)return res.status(400).json({error:'Interview not started'});
 let vp = null;

if (req.file) {
    vp = req.file.path + '.webm';
    fs.renameSync(req.file.path, vp);
}
 const answers=JSON.parse(req.body.answers||'[]'),qs=JSON.parse(c.questions);
 const tr=qs.map((q,i)=>`Q${i+1}: ${q}\nA: ${answers[i]||'(no answer)'}`).join('\n\n');
 let score=null,fb='AI evaluation unavailable (set ANTHROPIC_API_KEY).';
 try{const r=parse(await ai(`You are a strict but fair interviewer. Score the candidate 0-100 and give 3 sentences of feedback. Return ONLY JSON {"score":number,"feedback":"..."}.\n\nResume:\n${c.resume_text}\n\n${tr}`));score=r.score;fb=r.feedback}catch(e){console.error(e.message)}
 db.prepare(`update users set status='interviewed',video=?,transcript=?,ai_score=?,ai_feedback=?,flags=? where id=?`).run(vp,tr,score,fb,+req.body.flags||0,c.id);
 res.json({ok:true});
}));

app.listen(PORT,()=>console.log(`AI Interview running at ${APP_URL}`));
