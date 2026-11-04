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
    }
}
