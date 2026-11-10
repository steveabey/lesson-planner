# Interactive Lesson Planner

Upload a lesson plan and slides, turn them into a teaching sequence with activities between the slides, and run it live with pairs on laptops or iPads. Everything from Life vs Tech is included: freeze, "Time to listen", timer, showing a pair's screen, help buttons and every activity type.

This is a separate app from Life vs Tech, so your Life vs Tech app stays exactly as it is.

## Making a lesson

1. Open the app, choose **I'm the teacher** and enter the teacher code.
2. Press **＋ New lesson**.
3. **Your slides:** drop in a PDF, a PowerPoint (.pptx) or pictures. For an exact copy of your slides, save the PowerPoint as a PDF first. PowerPoint files are redrawn from their pictures and text, so fancy layouts may look simpler.
4. **Your lesson plan:** drop in a Word (.docx), PDF or text file, or paste the plan in.
5. Add the title, year group, subject and your name.
6. Choose how to build it:
   - **Draft it with AI:** the free Cloudflare AI reads your plan and slide text and puts activities between your slides. Always check the draft. The AI cannot see what is in picture-only slides, so it relies on the plan.
   - **Build it myself:** starts with your slides in order. Use the **＋** between steps to add an activity.
7. In the editor, click any step to change it. "What pupils see" shows a live preview. Use ▲▼ to reorder, and **Change to** to switch an activity type. Press **Save**.
8. Press **▶ Run lesson**, or run it later from the library.

All lessons are shared with every teacher who has the teacher code, and show who made them. The two example lessons can't be changed: press **Copy to edit** to make your own version.

## Putting it online (new GitHub repository + Cloudflare)

1. **GitHub:** create a new repository called `lesson-planner`. Upload everything inside this folder: `public`, `src`, `wrangler.jsonc` and `README.md`. Commit.
2. **Cloudflare:** go to **Workers & Pages → Create → Import a repository**, choose `lesson-planner`, and press **Deploy**. The AI connection is set up automatically from `wrangler.jsonc`.
3. **Teacher code:** open the new worker, then **Settings → Variables and Secrets → Add**. Choose type **Secret**, name `TEACHER_CODE`, and enter your code. Until you do this, it is `walden`.

## Costs and limits

- Everything runs on Cloudflare's free plan.
- The free AI allowance is 10,000 "neurons" a day, which should cover a handful of lesson drafts a day. If it runs out, the app says so: build the lesson yourself, or try again the next day (the allowance resets at midnight UTC).
- Each picture can be up to about 1.8 MB. Slides are compressed automatically.
- Pupils' names and answers are deleted when you end a lesson, or after 4 hours. Saved lessons stay in the library until you delete them.
