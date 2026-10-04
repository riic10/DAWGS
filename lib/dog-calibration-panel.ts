import type { DogCalibration, DogProfile } from "./dog-profile";

export function createDogCalibrationPanel(host: HTMLElement, options: {
  profile: DogProfile;
  calibration?: DogCalibration;
  onApply: (calibration: DogCalibration) => Promise<DogProfile>;
  onPreview: (visible: boolean, landmark?: string) => void;
  onFocus: () => void;
}) {
  let profile = options.profile, calibration = options.calibration ?? {};
  const details = document.createElement("details");
  details.className = "dog-calibration";
  const summary = document.createElement("summary");
  summary.textContent = "Adjust dog fit";
  details.append(summary);
  const fieldset = document.createElement("fieldset");
  fieldset.style.cssText = "border:0;padding:6px 0;display:grid;gap:6px;min-width:0";
  details.append(fieldset);
  function label(text: string, control: HTMLElement) {
    const element = document.createElement("label");
    element.style.cssText = "display:flex;gap:8px;align-items:center;justify-content:space-between";
    element.append(document.createTextNode(text), control);
    fieldset.append(element);
  }
  function select(items: [string, string][]) {
    const element = document.createElement("select");
    items.forEach(([value, text]) => element.add(new Option(text, value)));
    return element;
  }
  const facing = select([["auto", "Automatic"], ["reverse", "Reverse"]]);
  const pose = select([["auto", "Automatic"], ["stand", "Standing"], ["sit", "Sitting"]]);
  label("Facing", facing); label("Original pose", pose);
  const applyPose = document.createElement("button");
  applyPose.type = "button"; applyPose.textContent = "Refit direction and pose";
  fieldset.append(applyPose);
  const joint = select(Object.keys(profile.landmarks ?? {}).map(key => [key, key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase())]));
  joint.value = "upperLip";
  label("Joint", joint);
  const help = document.createElement("small");
  help.textContent = "Yellow marks the selected joint. Positions are percentages of dog height. Positive forward points toward the nose.";
  fieldset.append(help);
  const focus = document.createElement("button");
  focus.type = "button"; focus.textContent = "Zoom to dog";
  focus.onclick = options.onFocus;
  fieldset.append(focus);
  const axes = ["Forward", "Height", "Side"].map(name => {
    const input = document.createElement("input");
    input.type = "number"; input.step = "0.01"; input.min = "-300"; input.max = "300";
    input.style.width = "75px";
    label(name, input);
    return input;
  });
  const width = document.createElement("input");
  width.type = "number"; width.step = "0.01"; width.min = "1"; width.max = "50"; width.style.width = "75px";
  label("Mouth width", width);
  const apply = document.createElement("button");
  apply.type = "button"; apply.textContent = "Apply joint adjustment";
  const reset = document.createElement("button");
  reset.type = "button"; reset.textContent = "Reset automatic fit";
  fieldset.append(apply, reset);
  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  details.append(notice);
  host.append(details);

  function refresh() {
    facing.value = calibration.reverse ? "reverse" : "auto";
    pose.value = calibration.startsStanding === undefined ? "auto" : calibration.startsStanding ? "stand" : "sit";
    const point = profile.landmarks?.[joint.value];
    if (point) [point.x * -100, point.y * -100, point.z * 100].forEach((v, i) => { axes[i].value = v.toFixed(2); });
    axes[2].disabled = ["jawHinge", "upperLip", "lowerLip"].includes(joint.value);
    width.value = (profile.mouth.width * 100).toFixed(2);
    options.onPreview(details.open, joint.value);
  }
  async function commit(next: DogCalibration) {
    fieldset.disabled = true;
    notice.textContent = "Fitting…";
    try {
      profile = await options.onApply(next);
      calibration = next;
      notice.textContent = "Fit applied. Close this panel to try it.";
      refresh();
    } catch (error) {
      notice.textContent = error instanceof Error ? error.message : "The fit could not be applied.";
    } finally { fieldset.disabled = false; }
  }
  applyPose.onclick = () => void commit({ reverse: facing.value === "reverse",
    startsStanding: pose.value === "auto" ? undefined : pose.value === "stand" });
  joint.onchange = refresh;
  summary.onclick = event => {
    event.preventDefault();
    details.open = !details.open;
    options.onPreview(details.open, joint.value);
  };
  details.ontoggle = () => options.onPreview(details.open, joint.value);
  apply.onclick = () => {
    if (![...axes, width].every(input => input.value.trim() && input.reportValidity())) return;
    void commit({ ...calibration, mouthWidth: Number(width.value) / 100, points: {
      ...calibration.points, [joint.value]: [Number(axes[0].value) / -100, Number(axes[1].value) / -100, Number(axes[2].value) / 100],
    } });
  };
  reset.onclick = () => void commit({});
  refresh();
  return { dispose() { options.onPreview(false); details.remove(); } };
}
