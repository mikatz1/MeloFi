// Consent documents shown at sign-up. Bump a version when its text changes: every agreement is
// stored with the version the user saw, so a later change can ask again.
// OPERATOR / CONTACT come from the environment so the deployed text names the real operator.

export function documents(env = process.env) {
  const op = env.MELOFI_OPERATOR || 'MeloFi 운영자';
  const contact = env.MELOFI_CONTACT || '(운영자 연락처)';
  return {
    terms: {
      version: '2026-11-10',
      required: true,
      title: '서비스 이용약관',
      body: [
        `MeloFi 온라인 서비스(이하 "서비스")는 ${op}가 제공합니다.`,
        '본 서비스는 작곡 스튜디오 프로젝트의 온라인 저장 및 공유 기능을 제공합니다.',
        '회원은 본인이 적법한 권리를 보유한 콘텐츠만 업로드해야 하며, 공유된 프로젝트는 해당 링크를 보유한 누구나 열람할 수 있습니다.',
        '타인의 권리를 침해하거나 서비스의 정상적인 운영을 방해하는 데이터는 사전 통지 없이 삭제될 수 있습니다.',
        '본 서비스는 무상으로 제공되며, 운영상 필요한 경우 서비스 내용이 변경되거나 종료될 수 있습니다. 서비스 종료 시 프로젝트를 백업할 수 있도록 미리 안내합니다.',
        '회원은 앱 내 계정 설정에서 언제든지 탈퇴할 수 있습니다.',
      ],
    },
    privacy: {
      version: '2026-11-10',
      required: true,
      title: '개인정보 수집·이용 동의',
      table: [
        ['수집 항목', '이메일 주소, 비밀번호(일방향 암호화 보관), 닉네임, 온라인 저장 프로젝트 데이터, 가입 및 로그인 일시'],
        ['수집 목적', '회원 식별 및 인증, 프로젝트 온라인 저장·불러오기·공유, 고객 문의 대응 및 계정 관련 안내'],
        ['보유 기간', '회원 탈퇴 시까지 보관하며, 탈퇴 시 계정 및 관련 데이터는 지체 없이 파기됩니다.'],
      ],
      body: [
        '개인정보 수집·이용에 동의하지 않을 권리가 있습니다. 미동의 시 회원가입 및 온라인 저장·공유 기능 이용이 제한되며, 내 컴퓨터에서 작곡하고 파일로 저장하는 기능은 그대로 이용할 수 있습니다.',
        `개인정보 보호 문의: ${contact}`,
      ],
    },
    marketing: {
      version: '2026-11-10',
      required: false,
      title: '마케팅 정보 수신 동의',
      table: [
        ['수집 항목', '이메일 주소'],
        ['이용 목적', '새 기능, 새 악기, 이벤트 소식 안내'],
        ['보유 기간', '동의를 철회하거나 회원 탈퇴할 때까지'],
      ],
      body: [
        '선택 수집 항목으로 동의하지 않아도 서비스 기본 기능을 모두 이용할 수 있습니다.',
        '동의 철회는 앱 내 계정 설정에서 언제든지 가능합니다.',
      ],
    },
    age: {
      version: '2026-11-10',
      required: true,
      title: '만 14세 이상입니다',
      body: ['만 14세 미만 아동은 법정대리인 동의 절차가 필요하므로 회원가입이 제한됩니다.'],
    },
  };
}
