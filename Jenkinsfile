pipeline {
    agent any

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timestamps()
    }

    stages {
        stage('Repo info') {
            steps {
                sh 'git log --oneline -3'
                sh 'ls -la'
            }
        }

        stage('Check project') {
            steps {
                sh 'ls backend frontend'
                sh 'test -f backend/Dockerfile && test -f frontend/Dockerfile && echo "Both Dockerfiles found"'
            }
        }

        stage('Where am I?') {
            steps {
                sh 'echo "user: $(whoami)"; echo "workspace: $WORKSPACE"; echo "build: $BUILD_NUMBER"'
            }
        }

        stage('Backend: install + check') {
            steps {
                sh '''
                    docker run --rm \
                      -u "$(id -u):$(id -g)" -e HOME=/tmp \
                      -v "$WORKSPACE/backend":/app -w /app \
                      node:24-alpine \
                      sh -c "if [ -f package-lock.json ]; then npm ci; else npm install; fi && node --check server.js && echo 'backend OK'"
                '''
            }
        }

        stage('Frontend: install + build') {
            steps {
                sh '''
                    docker run --rm \
                      -u "$(id -u):$(id -g)" -e HOME=/tmp \
                      -v "$WORKSPACE/frontend":/app -w /app \
                      node:24-alpine \
                      sh -c "if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm run build && ls -la dist"
                '''
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'frontend/dist/**', fingerprint: true
        }
    }
}
