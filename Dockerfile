FROM python:3.13-slim
WORKDIR /app
COPY aidebugger /app/aidebugger
COPY docs /app/docs
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 65534:65534
EXPOSE 8787
CMD ["python", "-m", "aidebugger.web", "--host", "0.0.0.0"]
