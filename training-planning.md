# Training

A new subsystem to be created.

/training is a public facing route (access via app.bluurock.com/training) and serves potential employees. Potential employees usually undergo training for a few days to determine the best candidates before hiring/onboarding. 

# src/app/training

Main text: "Bluu Rock Training"
Sub text: Explain that only approved users may proceed, an admin will add them which will grant access. 

Text Box: Email
Button: Continue

# src/app/training/home



# src/app/training/media-gen 

Training module/type: Media Generation
First of many training modules.

- New user (first-time page open): Must get their name.
- Explain the test and procedures.
- Display next part to be completed.
- Display "Start" button or a countdown until when the button goes live.

The training module consists out of many tasks that are each timed individually.

After clicking start, the task must display with its description, media, and any input it requires; and a big count down must start for the specified task. The timer should flash at relevant intervals, and flash continuously once only a minute is left. Once the timer elapses, the page must promptly be closed for the user.

Parts:
1. ID Swap SFW (4 Images)
⏰ Task Time: 20 minutes
📜 Description:  Applicant will be given a folder of 10 images. They will choose 2 images to work with. For each image they must choose two options below which are different from each other to ensure all 4 edits are completed:
Image 1: Only swap the face
Image 2: Face + pose
Image 3: Face + pose + body
Image 4: Face + post + body + background


# src/app/(main)/admin-portal/training

An admin user primarily views training sessions and their progress here.

- The admin creates a new training session by adding one or more emails and select the training module (in this case only media-gen for now).
- The admin should then be able to open the training session which shows all the different parts of the training module along with the participants.


# Considerations

Only providing an email is not strong security at all, but since only specified emails are allowed and only for a limited time, it is likely that the person entering an allowable email is the actual person meant to access the page -- but still consider basic measures for bot protection and any other abuse. 