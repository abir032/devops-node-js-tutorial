pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timestamps()
    }

    environment {
        BACKEND_IMAGE  = 'node-tutorial-backend'
        FRONTEND_IMAGE = 'node-tutorial-frontend'
        COMPOSE_FILE   = 'deploy/docker-compose.yml'
    }

    stages {

        // =========================  CI  =========================
        stage('CI') {
            stages {
                stage('Commit info') {
                    steps {
                        sh 'git log --oneline -1'
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

                stage('Build images') {
                    steps {
                        sh '''
                            GIT_SHORT=$(git rev-parse --short HEAD)

                            docker build \
                              -t $BACKEND_IMAGE:$BUILD_NUMBER \
                              -t $BACKEND_IMAGE:$GIT_SHORT \
                              -t $BACKEND_IMAGE:latest \
                              --label git.commit=$GIT_SHORT \
                              --label jenkins.build=$BUILD_NUMBER \
                              backend

                            docker build \
                              -t $FRONTEND_IMAGE:$BUILD_NUMBER \
                              -t $FRONTEND_IMAGE:$GIT_SHORT \
                              -t $FRONTEND_IMAGE:latest \
                              --label git.commit=$GIT_SHORT \
                              --label jenkins.build=$BUILD_NUMBER \
                              frontend
                        '''
                    }
                }
            }
        }

        // =========================  CD  =========================
        stage('CD') {
            stages {
                stage('Deploy') {
                    steps {
                        withCredentials([
                            string(credentialsId: 'node-db-root-password', variable: 'DB_ROOT_PASSWORD'),
                            string(credentialsId: 'node-db-app-password',  variable: 'DB_PASSWORD')
                        ]) {
                            sh '''
                                export IMAGE_TAG=$BUILD_NUMBER
                                docker compose -f $COMPOSE_FILE config --quiet
                                docker compose -f $COMPOSE_FILE up -d --wait --wait-timeout 180
                                docker compose -f $COMPOSE_FILE ps
                            '''
                        }
                    }
                }
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'frontend/dist/**', fingerprint: true
            echo "✅ Build #${BUILD_NUMBER} deployed"
        }
        failure {
            echo "❌ Build #${BUILD_NUMBER} failed"
        }
        always {
            sh 'docker image prune -f'
        }
    }
}
