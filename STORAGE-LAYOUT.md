# 김고수 소스와 배포 위치

- `G:\src\kimgosu`: Git 작업 디렉터리. 앱 소스, Dockerfile, Compose, 배포 스크립트 및 GitHub Actions 설정을 버전 관리합니다.
- `G:\docker\kimgosu`: 배포 작업 디렉터리. 배포할 버전의 Compose 및 Nginx 설정을 배치하고, 로컬 `.env` 및 `secrets`를 보관합니다.
- `G:\shared_storage\kimgosu`: PostgreSQL, Redis, 업로드, 스케줄러 영속 데이터. Git에 넣지 않습니다.

`G:\docker`는 배포 파일 경로입니다. 이 폴더를 만든다고 Docker Desktop의 이미지/가상 디스크 저장 위치가 변경되지는 않습니다. 엔진의 저장 위치는 설치 후 별도로 확인합니다.

## 예정된 배포 흐름

1. 소스 폴더에서 commit 후 GitHub main 브랜치로 push합니다. 로컬 commit만으로는 GitHub Actions가 시작되지 않습니다.
2. GitHub-hosted runner에서 테스트, 이미지 빌드, GHCR 게시를 수행합니다.
3. Windows self-hosted runner가 검증된 커밋의 배포 파일과 이미지 digest를 받아 배포합니다.
4. 배포 파일은 `G:\docker\kimgosu`에 반영하되 `.env`와 `secrets`는 보존합니다.
5. DB 마이그레이션 성공 후 앱 컨테이너를 교체하고 상태를 확인합니다.

Runner checkout은 임시 작업 폴더를 사용하고 개발자의 `G:\src\kimgosu` 작업 내용을 변경하지 않습니다. 영속 데이터는 checkout이나 배포 파일 복사 대상에 포함하지 않습니다.

## 현재 상태

소스용 로컬 Git 저장소와 Compose 초안만 준비되어 있습니다. GitHub remote는 `https://github.com/mintech123/kimgosu.git`에 연결했습니다. Compose 검사용 Actions workflow를 준비했습니다. 앱 소스, Dockerfile, 이미지 빌드·배포 workflow, Docker 및 Runner 연결은 아직 구성하지 않았습니다.

`G:\docker\kimgosu\docker-compose.yml`에 기존 파일이 있어 보존했습니다. 소스의 Compose와 내용이 다르므로 최초 배포 전에 비교하여 적용해야 합니다. 자동 배포는 아직 활성화되어 있지 않습니다.
