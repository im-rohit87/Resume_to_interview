import os
import smtplib
from email.message import EmailMessage
from dotenv import load_dotenv

load_dotenv()

print("SMTP_HOST:", os.getenv("SMTP_HOST"))
print("SMTP_PORT:", os.getenv("SMTP_PORT"))
print("SMTP_USER:", os.getenv("SMTP_USER"))
print("SMTP_PASS exists:", bool(os.getenv("SMTP_PASS")))

msg = EmailMessage()
msg["Subject"] = "SMTP Test"
msg["From"] = os.getenv("SMTP_USER")
msg["To"] = "YOUR_RECEIVER_EMAIL@gmail.com"
msg.set_content("This is a test email.")

try:
    with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT"))) as server:
        server.starttls()
        server.login(
            os.getenv("SMTP_USER"),
            os.getenv("SMTP_PASS")
        )
        server.send_message(msg)

    print("✅ EMAIL SENT SUCCESSFULLY")

except Exception as e:
    print("❌ EMAIL FAILED")
    print("ERROR:", e)