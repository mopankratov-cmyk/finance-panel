import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — norvia",
  description: "Политика конфиденциальности бренда norvia",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 text-slate-800">
      <p className="text-sm font-semibold tracking-wide text-slate-500">norvia</p>
      <h1 className="mt-1 text-2xl font-semibold">Политика конфиденциальности</h1>
      <p className="mt-2 text-sm text-slate-500">Дата вступления в силу: 6 июля 2026 г.</p>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">1. Общие положения</h2>
        <p>
          Настоящая политика описывает, какие данные собирает и обрабатывает бренд
          <strong> norvia</strong> (далее — «Сервис») при использовании внутренних
          инструментов управления контентом и его публикации в социальных сетях и на
          маркетплейсах, включая интеграции через API сторонних платформ (в том числе
          Pinterest).
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">2. Какие данные обрабатываются</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Учётные данные и токены доступа (access token / refresh token), выданные
            подключёнными платформами по протоколу OAuth, — используются только для
            публикации контента и получения статистики по опубликованным материалам
            от имени владельца подключённого аккаунта.
          </li>
          <li>
            Медиаконтент (изображения, видео, тексты описаний), который Сервис
            публикует по запросу владельца аккаунта.
          </li>
          <li>
            Агрегированные метрики публикаций (просмотры, клики, вовлечённость),
            получаемые через API подключённых платформ для внутренней аналитики.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">3. Как используются данные</h2>
        <p>
          Данные используются исключительно для планирования и публикации контента,
          а также для построения внутренней отчётности по эффективности публикаций.
          Сервис не передаёт полученные данные третьим лицам и не использует их в
          целях, не связанных с работой владельца аккаунта.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">4. Хранение и защита данных</h2>
        <p>
          Токены доступа хранятся в защищённом виде и используются только серверной
          частью Сервиса. Доступ к ним ограничен кругом лиц, отвечающих за
          техническую эксплуатацию Сервиса.
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">5. Отзыв доступа</h2>
        <p>
          Владелец подключённого аккаунта может в любой момент отозвать доступ
          Сервиса к своим данным через настройки соответствующей платформы
          (например, раздел «Приложения» в настройках аккаунта Pinterest).
        </p>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-lg font-medium">6. Контакты</h2>
        <p>
          По вопросам, связанным с обработкой данных, можно обратиться по адресу:{" "}
          <a className="text-violet-600 underline" href="mailto:maxpan280199@gmail.com">
            maxpan280199@gmail.com
          </a>
          .
        </p>
      </section>
    </div>
  );
}
