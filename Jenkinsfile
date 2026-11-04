// Deploy the images of this build to one environment.
// envName: dev / staging / prod   apiPort, webPort: host ports for that environment
def deployTo(String envName, String apiPort, String webPort) {
    withCredentials([
        string(credentialsId: 'node-db-root-password', variable: 'DB_ROOT_PASSWORD'),
        string(credentialsId: 'node-db-app-password',  variable: 'DB_PASSWORD')
    ]) {
        withEnv(["APP_ENV=${envName}", "API_PORT=${apiPort}", "WEB_PORT=${webPort}"]) {
            sh '''
                export IMAGE_TAG=$BUILD_NUMBER
                PROJECT=node-tutorial-$APP_ENV
                echo "Deploying build #$BUILD_NUMBER to $APP_ENV (api :$API_PORT, web :$WEB_PORT)"
                docker compose -p $PROJECT -f $COMPOSE_FILE config --quiet
                docker compose -p $PROJECT -f $COMPOSE_FILE up -d --wait --wait-timeout 180
                docker compose -p $PROJECT -f $COMPOSE_FILE ps
            '''
        }
    }
}

pipeline {
    agent any

    triggers {
        pollSCM('H/2 * * * *')
    }

    parameters {
        choice(name: 'DEPLOY_UNTIL', choices: ['prod', 'staging', 'dev'],
               description: 'How far to promote this build (prod still needs approval)')
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
                stage('Deploy DEV') {
                    steps {
                        script { deployTo('dev', '8180', '8181') }
                    }
                }

                stage('Deploy STAGING') {
                    when { expression { params.DEPLOY_UNTIL != 'dev' } }
                    steps {
                        script { deployTo('staging', '8280', '8281') }
                    }
                }

                stage('Approve PROD') {
                    when { expression { params.DEPLOY_UNTIL == 'prod' } }
                    steps {
                        timeout(time: 30, unit: 'MINUTES') {
                            input message: "Deploy build #${BUILD_NUMBER} to PROD?",
                                  ok: 'Deploy to prod'
                        }
                    }
                }

                stage('Deploy PROD') {
                    when { expression { params.DEPLOY_UNTIL == 'prod' } }
                    steps {
                        script { deployTo('prod', '8380', '8381') }
                    }
                }
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'frontend/dist/**', fingerprint: true
            echo "✅ Build #${BUILD_NUMBER} done (promoted until: ${params.DEPLOY_UNTIL})"
        }
        aborted {
            echo "⏹ Build #${BUILD_NUMBER} stopped: prod approval was refused or timed out"
        }
        failure {
            echo "❌ Build #${BUILD_NUMBER} failed"
        }
        always {
            sh 'docker image prune -f'
        }
    }
}
