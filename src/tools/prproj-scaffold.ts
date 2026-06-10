// Static Premiere .prproj scaffolding, extracted VERBATIM from a real
// Premiere-accepted project file (a single-sequence export). These blocks are
// sequence-agnostic — Project settings, columns, color management, the project bin
// (RootProjectItem/BinProjectItem/ClipProjectItem), and the audio master-mixer
// chain are byte-identical across exports and required for Premiere to load.
//
// We generate ONLY the editorial content (sequence MasterClip + media/clips/tracks/
// sequence) and splice it between PROJECT_PREFIX and AUDIO_MIXER. Generated
// top-level ObjectIDs start at 1000 (prefix uses 1-39, mixer uses 50-64).
//
// The scaffold's ClipProjectItem (the sequence's bin entry) references a sequence
// MasterClip with UID SEQ_MASTERCLIP_UID — our editorial content MUST define a
// MasterClip with exactly that UID. The audio mixer references the first audio
// track via __A1_TRACK_UID__.
//
// Placeholders: __PROJECT_NAME__ (prefix), __A1_TRACK_UID__ (mixer).

export const PROJECT_PREFIX = `	<Project ObjectRef="1"/>
	<Project ObjectID="1" ClassID="62ad66dd-0dcd-42da-a660-6d8fbde94876" Version="42">
		<Node Version="1">
			<Properties Version="1">
				<ProjectViewState.List ObjectID="2" ClassID="aab0946f-7a21-4425-8908-fafa2119e30e" Version="3">
					<ProjectViewStates Version="1">
						<ProjectViewState Version="1" Index="0">
							<First>350252c6-b39e-4bdb-bbe4-52d2c8b55721</First>
							<Second ObjectRef="1"/>
						</ProjectViewState>
					</ProjectViewStates>
					<ProjectViewState ObjectID="1" ClassID="18fb911d-4f21-4b7b-b196-b250dad79838" Version="3">
						<ProjectViewState.ID>350252c6-b39e-4bdb-bbe4-52d2c8b55721</ProjectViewState.ID>
						<ColumnListContents.Version>18</ColumnListContents.Version>
						<ProjectViewState.OriginalID>00000000-0000-0000-0000-000000000000</ProjectViewState.OriginalID>
						<ProjectViewState.BinID>1000000</ProjectViewState.BinID>
						<ProjectViewState.ViewHidden>false</ProjectViewState.ViewHidden>
						<PreviewView.Visible>false</PreviewView.Visible>
						<ContentView.LastViewed>0</ContentView.LastViewed>
						<IconView.Thumbnail.Size>200</IconView.Thumbnail.Size>
						<FreeformView.Scale>1</FreeformView.Scale>
						<ListView.Thumbnail.Size>0</ListView.Thumbnail.Size>
						<IconView.Thumbnail.State>true</IconView.Thumbnail.State>
						<ListView.Thumbnail.State>false</ListView.Thumbnail.State>
						<Thumbnail.ShowsEffects.State>true</Thumbnail.ShowsEffects.State>
						<Sort.Type>0</Sort.Type>
						<Sort.Enabled>true</Sort.Enabled>
						<Sort.ColumnIndex>1</Sort.ColumnIndex>
						<Sort.Direction>0</Sort.Direction>
						<ListView.NameColumnWidth>0</ListView.NameColumnWidth>
						<IconSort.Type>0</IconSort.Type>
						<IconSort.Direction>0</IconSort.Direction>
						<IconSort.ColumnIndex>0</IconSort.ColumnIndex>
						<SideNav.Visible>true</SideNav.Visible>
						<SideNav.Width>160</SideNav.Width>
						<Project.IsEAProject>false</Project.IsEAProject>
						<Columns.List ObjectRef="2"/>
					</ProjectViewState>
					<ColumnList ObjectID="2" ClassID="a1c709cd-35df-4821-8200-03565d374155" Version="1">
						<Columns Version="1">
							<Column Index="0" ObjectRef="3"/>
							<Column Index="1" ObjectRef="4"/>
							<Column Index="2" ObjectRef="5"/>
							<Column Index="3" ObjectRef="6"/>
							<Column Index="4" ObjectRef="7"/>
							<Column Index="5" ObjectRef="8"/>
							<Column Index="6" ObjectRef="9"/>
							<Column Index="7" ObjectRef="10"/>
							<Column Index="8" ObjectRef="11"/>
							<Column Index="9" ObjectRef="12"/>
							<Column Index="10" ObjectRef="13"/>
							<Column Index="11" ObjectRef="14"/>
							<Column Index="12" ObjectRef="15"/>
							<Column Index="13" ObjectRef="16"/>
							<Column Index="14" ObjectRef="17"/>
							<Column Index="15" ObjectRef="18"/>
							<Column Index="16" ObjectRef="19"/>
							<Column Index="17" ObjectRef="20"/>
							<Column Index="18" ObjectRef="21"/>
							<Column Index="19" ObjectRef="22"/>
							<Column Index="20" ObjectRef="23"/>
							<Column Index="21" ObjectRef="24"/>
							<Column Index="22" ObjectRef="25"/>
							<Column Index="23" ObjectRef="26"/>
							<Column Index="24" ObjectRef="27"/>
							<Column Index="25" ObjectRef="28"/>
							<Column Index="26" ObjectRef="29"/>
							<Column Index="27" ObjectRef="30"/>
							<Column Index="28" ObjectRef="31"/>
							<Column Index="29" ObjectRef="32"/>
							<Column Index="30" ObjectRef="33"/>
							<Column Index="31" ObjectRef="34"/>
							<Column Index="32" ObjectRef="35"/>
							<Column Index="33" ObjectRef="36"/>
							<Column Index="34" ObjectRef="37"/>
							<Column Index="35" ObjectRef="38"/>
							<Column Index="36" ObjectRef="39"/>
							<Column Index="37" ObjectRef="40"/>
							<Column Index="38" ObjectRef="41"/>
							<Column Index="39" ObjectRef="42"/>
							<Column Index="40" ObjectRef="43"/>
							<Column Index="41" ObjectRef="44"/>
							<Column Index="42" ObjectRef="45"/>
							<Column Index="43" ObjectRef="46"/>
							<Column Index="44" ObjectRef="47"/>
							<Column Index="45" ObjectRef="48"/>
							<Column Index="46" ObjectRef="49"/>
							<Column Index="47" ObjectRef="50"/>
							<Column Index="48" ObjectRef="51"/>
							<Column Index="49" ObjectRef="52"/>
							<Column Index="50" ObjectRef="53"/>
							<Column Index="51" ObjectRef="54"/>
							<Column Index="52" ObjectRef="55"/>
							<Column Index="53" ObjectRef="56"/>
							<Column Index="54" ObjectRef="57"/>
							<Column Index="55" ObjectRef="58"/>
							<Column Index="56" ObjectRef="59"/>
							<Column Index="57" ObjectRef="60"/>
						</Columns>
					</ColumnList>
					<LabelColumn ObjectID="3" ClassID="0b8cc011-65dd-4b47-aad9-751ca2891f4a" Version="1">
						<Column.Name>Label</Column.Name>
						<Column.ID>Column.PropertyText.Label</Column.ID>
						<Column.Type>17</Column.Type>
						<Column.Class>1</Column.Class>
						<Column.Width>26</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</LabelColumn>
					<SelectedItemsColumn ObjectID="4" ClassID="88bcfb15-97a7-49ed-ac05-7d3ce637d2a0" Version="1">
						<Column.Name>Selected</Column.Name>
						<Column.ID>Column.PropertyText.SelectedItems</Column.ID>
						<Column.Type>0</Column.Type>
						<Column.Class>1</Column.Class>
						<Column.Width>26</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</SelectedItemsColumn>
					<NameColumn ObjectID="5" ClassID="0547b302-c849-46b3-ae2a-b245e9dd59eb" Version="1">
						<Column.Name>Name</Column.Name>
						<Column.ID>Column.Intrinsic.Name</Column.ID>
						<Column.Type>24</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>200</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</NameColumn>
					<StringColumn ObjectID="6" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Media Type</Column.Name>
						<Column.ID>Column.Intrinsic.MediaType</Column.ID>
						<Column.Type>23</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="7" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Frame Rate</Column.Name>
						<Column.ID>Column.Intrinsic.MediaTimebase</Column.ID>
						<Column.Type>22</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
					<TimecodeColumn ObjectID="8" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Media Start</Column.Name>
						<Column.ID>Column.Intrinsic.MediaStart</Column.ID>
						<Column.Type>21</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="9" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Media End</Column.Name>
						<Column.ID>Column.Intrinsic.MediaEnd</Column.ID>
						<Column.Type>20</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="10" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Media Duration</Column.Name>
						<Column.ID>Column.Intrinsic.MediaDuration</Column.ID>
						<Column.Type>19</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="11" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Video In Point</Column.Name>
						<Column.ID>Column.Intrinsic.VideoInPoint</Column.ID>
						<Column.Type>35</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="12" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Video Out Point</Column.Name>
						<Column.ID>Column.Intrinsic.VideoOutPoint</Column.ID>
						<Column.Type>36</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="13" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Video Duration</Column.Name>
						<Column.ID>Column.Intrinsic.VideoDuration</Column.ID>
						<Column.Type>33</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="14" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Audio In Point</Column.Name>
						<Column.ID>Column.Intrinsic.AudioInPoint</Column.ID>
						<Column.Type>3</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="15" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Audio Out Point</Column.Name>
						<Column.ID>Column.Intrinsic.AudioOutPoint</Column.ID>
						<Column.Type>4</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="16" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Audio Duration</Column.Name>
						<Column.ID>Column.Intrinsic.AudioDuration</Column.ID>
						<Column.Type>1</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="17" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Subclip Start</Column.Name>
						<Column.ID>Column.Intrinsic.SubclipStart</Column.ID>
						<Column.Type>39</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="18" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Subclip End</Column.Name>
						<Column.ID>Column.Intrinsic.SubclipEnd</Column.ID>
						<Column.Type>40</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="19" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Subclip Duration</Column.Name>
						<Column.ID>Column.Intrinsic.SubclipDuration</Column.ID>
						<Column.Type>41</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</TimecodeColumn>
					<StringColumn ObjectID="20" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Video Info</Column.Name>
						<Column.ID>Column.Intrinsic.VideoInfo</Column.ID>
						<Column.Type>34</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="21" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Audio Info</Column.Name>
						<Column.ID>Column.Intrinsic.AudioInfo</Column.ID>
						<Column.Type>2</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>150</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="22" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Video Usage</Column.Name>
						<Column.ID>Column.Intrinsic.VideoUsage</Column.ID>
						<Column.Type>38</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="23" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Audio Usage</Column.Name>
						<Column.ID>Column.Intrinsic.AudioUsage</Column.ID>
						<Column.Type>6</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<EditTextColumn ObjectID="24" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Tape Name</Column.Name>
						<Column.ID>Column.Intrinsic.TapeName</Column.ID>
						<Column.Type>30</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="25" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Description</Column.Name>
						<Column.ID>Column.PropertyText.Description</Column.ID>
						<Column.Type>15</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="26" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Comment</Column.Name>
						<Column.ID>Column.PropertyText.Comment</Column.ID>
						<Column.Type>10</Column.Type>
						<Column.Class>1</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="27" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Log Note</Column.Name>
						<Column.ID>Column.Intrinsic.LogNote</Column.ID>
						<Column.Type>18</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</EditTextColumn>
					<StringColumn ObjectID="28" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Media File Path</Column.Name>
						<Column.ID>Column.Intrinsic.FilePath</Column.ID>
						<Column.Type>16</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="29" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Status</Column.Name>
						<Column.ID>Column.PropertyText.Status</Column.ID>
						<Column.Type>29</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="30" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Offline Properties</Column.Name>
						<Column.ID>Column.PropertyText.OfflineProperties</Column.ID>
						<Column.Type>25</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="31" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Media File Name</Column.Name>
						<Column.ID>Column.Intrinsic.FileName</Column.ID>
						<Column.Type>58</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<EditTextColumn ObjectID="32" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Scene</Column.Name>
						<Column.ID>Column.PropertyText.Scene</Column.ID>
						<Column.Type>27</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="33" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Shot</Column.Name>
						<Column.ID>Column.PropertyText.Shot</Column.ID>
						<Column.Type>28</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="34" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Client</Column.Name>
						<Column.ID>Column.PropertyText.Client</Column.ID>
						<Column.Type>9</Column.Type>
						<Column.Class>1</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<BoolPropertyColumn ObjectID="35" ClassID="1d4dd772-4985-4f43-874a-84b2b566e724" Version="1">
						<Column.Name>Good</Column.Name>
						<Column.ID>Column.PropertyBool.Good</Column.ID>
						<Column.Type>0</Column.Type>
						<Column.Class>2</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
						<Column.Property.Key>Column.PropertyBool.Good</Column.Property.Key>
						<Column.Editable.Key>true</Column.Editable.Key>
					</BoolPropertyColumn>
					<BoolPropertyColumn ObjectID="36" ClassID="1d4dd772-4985-4f43-874a-84b2b566e724" Version="1">
						<Column.Name>Hide</Column.Name>
						<Column.ID>Column.PropertyBool.Hide</Column.ID>
						<Column.Type>0</Column.Type>
						<Column.Class>2</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
						<Column.Property.Key>Column.PropertyBool.Hide</Column.Property.Key>
						<Column.Editable.Key>true</Column.Editable.Key>
					</BoolPropertyColumn>
					<TimecodeColumn ObjectID="37" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Sound Timecode</Column.Name>
						<Column.ID>Column.Intrinsic.SoundTimeCode</Column.ID>
						<Column.Type>42</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="38" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Linear Timecode</Column.Name>
						<Column.ID>Column.Intrinsic.LinearTimeCode</Column.ID>
						<Column.Type>64</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<TimecodeColumn ObjectID="39" ClassID="9c9279d2-355c-487b-b644-0698b42e32f9" Version="1">
						<Column.Name>Aux Timecode</Column.Name>
						<Column.ID>Column.Intrinsic.AuxTimeCode</Column.ID>
						<Column.Type>65</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</TimecodeColumn>
					<EditTextColumn ObjectID="40" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Sound Roll</Column.Name>
						<Column.ID>Column.PropertyText.SoundRoll</Column.ID>
						<Column.Type>43</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="41" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Camera Roll</Column.Name>
						<Column.ID>Column.PropertyText.FilmCameraRoll</Column.ID>
						<Column.Type>47</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="42" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Daily Roll</Column.Name>
						<Column.ID>Column.PropertyText.FilmDailyRoll</Column.ID>
						<Column.Type>48</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="43" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Lab Roll</Column.Name>
						<Column.ID>Column.PropertyText.FilmLabRoll</Column.ID>
						<Column.Type>49</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="44" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Keycode</Column.Name>
						<Column.ID>Column.PropertyText.FilmKeycode</Column.ID>
						<Column.Type>50</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<StringColumn ObjectID="45" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Sync Offset</Column.Name>
						<Column.ID>Column.PropertyText.SyncOffset</Column.ID>
						<Column.Type>44</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="46" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Video Codec</Column.Name>
						<Column.ID>Column.PropertyText.Codec</Column.ID>
						<Column.Type>45</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="47" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Field Order</Column.Name>
						<Column.ID>Column.PropertyText.FieldOrder</Column.ID>
						<Column.Type>46</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="48" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Proxy</Column.Name>
						<Column.ID>Column.PropertyText.Proxy</Column.ID>
						<Column.Type>51</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="49" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Project Locked</Column.Name>
						<Column.ID>Column.PropertyText.BinLocked</Column.ID>
						<Column.Type>52</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<EditTextColumn ObjectID="50" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>ASC_SOP</Column.Name>
						<Column.ID>Column.PropertyText.ASCSOP</Column.ID>
						<Column.Type>53</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="51" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>ASC_SAT</Column.Name>
						<Column.ID>Column.PropertyText.ASCSAT</Column.ID>
						<Column.Type>54</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="52" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Lut</Column.Name>
						<Column.ID>Column.PropertyText.Lut</Column.ID>
						<Column.Type>55</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="53" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Lut1</Column.Name>
						<Column.ID>Column.PropertyText.Lut1</Column.ID>
						<Column.Type>56</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="54" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Lut2</Column.Name>
						<Column.ID>Column.PropertyText.Lut2</Column.ID>
						<Column.Type>57</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="55" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Original Video File Name</Column.Name>
						<Column.ID>Column.PropertyText.OriginalVideoFileName</Column.ID>
						<Column.Type>59</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<EditTextColumn ObjectID="56" ClassID="e9f21f9a-b686-440c-83f4-da1685c160ad" Version="1">
						<Column.Name>Original Audio File Name</Column.Name>
						<Column.ID>Column.PropertyText.OriginalAudioFileName</Column.ID>
						<Column.Type>60</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</EditTextColumn>
					<StringColumn ObjectID="57" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Proxy Media File Path</Column.Name>
						<Column.ID>Column.Intrinsic.ProxyFilePath</Column.ID>
						<Column.Type>37</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="58" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Proxy Media File Name</Column.Name>
						<Column.ID>Column.Intrinsic.ProxyFileName</Column.ID>
						<Column.Type>61</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>true</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="59" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Transcription Status</Column.Name>
						<Column.ID>Column.Intrinsic.TranscriptStatus</Column.ID>
						<Column.Type>63</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
					<StringColumn ObjectID="60" ClassID="f0ef302d-babc-4f75-9975-923a8ca28d7e" Version="1">
						<Column.Name>Content Credentials</Column.Name>
						<Column.ID>Column.Intrinsic.ContentCredentials</Column.ID>
						<Column.Type>66</Column.Type>
						<Column.Class>0</Column.Class>
						<Column.Width>100</Column.Width>
						<Column.IsHidden>false</Column.IsHidden>
					</StringColumn>
				</ProjectViewState.List>
				<BE.Prefs.AcceleratedRenderer.LastUsedIdentifier>6ed1497e-17ad-4a5b-846f-52bb81e20104</BE.Prefs.AcceleratedRenderer.LastUsedIdentifier>
				<BE.Prefs.AcceleratedRenderer.LastUsedDisplayName>Mercury Playback Engine GPU Acceleration (Metal)</BE.Prefs.AcceleratedRenderer.LastUsedDisplayName>
				<BE.Prefs.kPrefsAcceleratedRenderer.OverridenIdentifier>6ed1497e-17ad-4a5b-846f-52bb81e20104</BE.Prefs.kPrefsAcceleratedRenderer.OverridenIdentifier>
				<ProjectViewState.Version>2</ProjectViewState.Version>
				<MZ.Project.WorkspaceName>Vertical</MZ.Project.WorkspaceName>
				<project.settings.lastknowngoodprojectpath></project.settings.lastknowngoodprojectpath>
				<project.settings.lastknownparentdirectorypathaboveprojectpath></project.settings.lastknownparentdirectorypathaboveprojectpath>
				<MZ.Project.GUID>35a165b9-8e4e-4dc9-a286-9b0a866f140c</MZ.Project.GUID>
				<Project.Metadata.Schema>&lt;?xml version="1.0" encoding="UTF-8" ?&gt;&#10;&lt;xmp_definitions&gt;&#10;	&lt;xmp_schema namespace="http://ns.adobe.com/premierePrivateProjectMetaData/1.0/" prefix="premierePrivateProjectMetaData" label="$$$/Premiere/PrivateProProjectMetaData_label=Premiere Project Metadata"&gt;&#10;	&lt;/xmp_schema&gt;&#10;&lt;/xmp_definitions&gt;&#10;</Project.Metadata.Schema>
				<MZ.BuildVersion.Created>26.0.0x72 - Wed Jan 28 16:51:01 2026</MZ.BuildVersion.Created>
				<MZ.BuildVersion.Modified>26.0.0x72 - Wed Jan 28 16:51:16 2026</MZ.BuildVersion.Modified>
				<MZ.Project.ApplicationID>Pro</MZ.Project.ApplicationID>
				<TL.PJSnappingState>1</TL.PJSnappingState>
				<MZ.PrefixKey.OpenSequenceGuidList.1>__SEQUENCE_UID__</MZ.PrefixKey.OpenSequenceGuidList.1>
			</Properties>
		</Node>
		<RootProjectItem ObjectURef="297ab217-bd92-4c5f-ba6a-b6f8b848dbcd"/>
		<ProjectSettings ObjectRef="3"/>
		<MovieCompileSettings ObjectRef="4"/>
		<StillCompileSettings ObjectRef="5"/>
		<AudioCompileSettings ObjectRef="6"/>
		<CustomCompileSettings ObjectRef="7"/>
		<VideoPreviewCompileSettings ObjectRef="8"/>
		<ScratchDiskSettings ObjectRef="9"/>
		<IngestSettings ObjectRef="10"/>
		<ProjectWorkspace ObjectRef="11"/>
		<NextID>1000003</NextID>
		<Name>__PROJECT_NAME__</Name>
	</Project>
	<RootProjectItem ObjectUID="297ab217-bd92-4c5f-ba6a-b6f8b848dbcd" ClassID="1c307a89-9318-47d7-a583-bf2553736543" Version="1">
		<ProjectItem Version="1">
			<Node Version="1">
				<Properties Version="1">
					<ProjectViewState.ID>350252c6-b39e-4bdb-bbe4-52d2c8b55721</ProjectViewState.ID>
					<list.view.expanded.state.7feac601_45_20ac_45_443b_45_abd6_45_ab958cf0395b>true</list.view.expanded.state.7feac601_45_20ac_45_443b_45_abd6_45_ab958cf0395b>
					<list.view.expanded.state.5b1fe213_45_132d_45_4f39_45_9c7b_45_4c3a26dfe06f>true</list.view.expanded.state.5b1fe213_45_132d_45_4f39_45_9c7b_45_4c3a26dfe06f>
					<list.view.expanded.state.d49d5529_45_e44e_45_43c0_45_81f6_45_1f25123df015>true</list.view.expanded.state.d49d5529_45_e44e_45_43c0_45_81f6_45_1f25123df015>
				</Properties>
				<ID>1000000</ID>
			</Node>
			<Name>Root Bin</Name>
		</ProjectItem>
		<ProjectItemContainer Version="1">
			<Items Version="1">
				<Item Index="0" ObjectURef="39b972d0-9010-41af-8c4a-67aed9312854"/>
			</Items>
		</ProjectItemContainer>
	</RootProjectItem>
	<ProjectSettings ObjectID="3" ClassID="50c16708-a1a1-4d2f-98d5-4e283ae28353" Version="21">
		<VideoSettings ObjectRef="12"/>
		<AudioSettings ObjectRef="13"/>
		<VideoCompileSettings ObjectRef="14"/>
		<AudioCompileSettings ObjectRef="15"/>
		<CaptureSettings ObjectRef="16"/>
		<DefaultSequenceSettings ObjectRef="17"/>
		<ColorManagementSettings>{"enableLogColorManagement":2,"graphicsWhiteLuminance":203,"lutInterpolationMethod":1}</ColorManagementSettings>
		<VideoTimeDisplay>102</VideoTimeDisplay>
		<AudioTimeDisplay>200</AudioTimeDisplay>
		<VideoTimeDisplayInitial>999</VideoTimeDisplayInitial>
		<ActionSafeWidth>10</ActionSafeWidth>
		<ActionSafeHeight>10</ActionSafeHeight>
		<TitleSafeWidth>20</TitleSafeWidth>
		<TitleSafeHeight>20</TitleSafeHeight>
		<ShouldScaleMedia>false</ShouldScaleMedia>
		<EditingModeID>00000000-0000-0000-0000-000000000000</EditingModeID>
		<PreviewFileFormatID>00000000-0000-0000-0000-000000000000</PreviewFileFormatID>
		<UsePreviewCache>false</UsePreviewCache>
	</ProjectSettings>
	<CompileSettings ObjectID="4" ClassID="18a35d66-597e-4157-b783-938b5bec3547" Version="4">
		<VideoCompileSettings ObjectRef="18"/>
		<AudioCompileSettings ObjectRef="19"/>
		<CompilerClassIDFourCC>0</CompilerClassIDFourCC>
		<CompilerFourCC>0</CompilerFourCC>
		<ExportVideo>true</ExportVideo>
		<ExportAudio>true</ExportAudio>
		<AddToProjectWhenFinished>true</AddToProjectWhenFinished>
		<BeepWhenFinished>false</BeepWhenFinished>
		<ExportWorkAreaOnly>false</ExportWorkAreaOnly>
		<EmbedProjectLink>false</EmbedProjectLink>
	</CompileSettings>
	<CompileSettings ObjectID="5" ClassID="18a35d66-597e-4157-b783-938b5bec3547" Version="4">
		<VideoCompileSettings ObjectRef="20"/>
		<AudioCompileSettings ObjectRef="21"/>
		<CompilerClassIDFourCC>0</CompilerClassIDFourCC>
		<CompilerFourCC>0</CompilerFourCC>
		<ExportVideo>true</ExportVideo>
		<ExportAudio>true</ExportAudio>
		<AddToProjectWhenFinished>true</AddToProjectWhenFinished>
		<BeepWhenFinished>false</BeepWhenFinished>
		<ExportWorkAreaOnly>false</ExportWorkAreaOnly>
		<EmbedProjectLink>false</EmbedProjectLink>
	</CompileSettings>
	<CompileSettings ObjectID="6" ClassID="18a35d66-597e-4157-b783-938b5bec3547" Version="4">
		<VideoCompileSettings ObjectRef="22"/>
		<AudioCompileSettings ObjectRef="23"/>
		<CompilerClassIDFourCC>0</CompilerClassIDFourCC>
		<CompilerFourCC>0</CompilerFourCC>
		<ExportVideo>true</ExportVideo>
		<ExportAudio>true</ExportAudio>
		<AddToProjectWhenFinished>true</AddToProjectWhenFinished>
		<BeepWhenFinished>false</BeepWhenFinished>
		<ExportWorkAreaOnly>false</ExportWorkAreaOnly>
		<EmbedProjectLink>false</EmbedProjectLink>
	</CompileSettings>
	<CompileSettings ObjectID="7" ClassID="18a35d66-597e-4157-b783-938b5bec3547" Version="4">
		<VideoCompileSettings ObjectRef="24"/>
		<AudioCompileSettings ObjectRef="25"/>
		<CompilerClassIDFourCC>0</CompilerClassIDFourCC>
		<CompilerFourCC>0</CompilerFourCC>
		<ExportVideo>true</ExportVideo>
		<ExportAudio>true</ExportAudio>
		<AddToProjectWhenFinished>true</AddToProjectWhenFinished>
		<BeepWhenFinished>false</BeepWhenFinished>
		<ExportWorkAreaOnly>false</ExportWorkAreaOnly>
		<EmbedProjectLink>false</EmbedProjectLink>
	</CompileSettings>
	<CompileSettings ObjectID="8" ClassID="18a35d66-597e-4157-b783-938b5bec3547" Version="4">
		<VideoCompileSettings ObjectRef="26"/>
		<AudioCompileSettings ObjectRef="27"/>
		<CompilerClassIDFourCC>0</CompilerClassIDFourCC>
		<CompilerFourCC>0</CompilerFourCC>
		<ExportVideo>true</ExportVideo>
		<ExportAudio>true</ExportAudio>
		<AddToProjectWhenFinished>true</AddToProjectWhenFinished>
		<BeepWhenFinished>false</BeepWhenFinished>
		<ExportWorkAreaOnly>false</ExportWorkAreaOnly>
		<EmbedProjectLink>false</EmbedProjectLink>
	</CompileSettings>
	<ScratchDiskSettings ObjectID="9" ClassID="4c6ed82b-a81c-4df1-8bd0-750504c4b560" Version="4">
		<AudioPreviewLocation0>SameAsProject</AudioPreviewLocation0>
		<VideoPreviewLocation0>SameAsProject</VideoPreviewLocation0>
		<DVDEncodingLocation0>SameAsProject</DVDEncodingLocation0>
		<TransferMediaLocation0>SameAsProject</TransferMediaLocation0>
		<CapturedVideoLocation0>SameAsProject</CapturedVideoLocation0>
		<AutoSaveLocation0>SameAsProject</AutoSaveLocation0>
		<CapsuleMediaLocation0>SameAsProject</CapsuleMediaLocation0>
		<CCLibrariesLocation0>SameAsProject</CCLibrariesLocation0>
	</ScratchDiskSettings>
	<IngestSettings ObjectID="10" ClassID="2db8f76b-2c37-48ee-925d-9a4f7278152d" Version="2">
		<Action>copy</Action>
		<Enabled>false</Enabled>
	</IngestSettings>
	<WorkspaceSettings ObjectID="11" ClassID="c4372273-e1aa-4683-98aa-a2ceadf3066c" Version="1">
	</WorkspaceSettings>
	<BinProjectItem ObjectUID="39b972d0-9010-41af-8c4a-67aed9312854" ClassID="dbfd6653-24da-480e-a35e-ba45e9504e4b" Version="1">
		<ProjectItem Version="1">
			<Node Version="1">
				<Properties Version="1">
					<project.icon.view.grid.order>0</project.icon.view.grid.order>
					<list.view.expanded.state.7feac601_45_20ac_45_443b_45_abd6_45_ab958cf0395b>false</list.view.expanded.state.7feac601_45_20ac_45_443b_45_abd6_45_ab958cf0395b>
					<list.view.expanded.state.5b1fe213_45_132d_45_4f39_45_9c7b_45_4c3a26dfe06f>false</list.view.expanded.state.5b1fe213_45_132d_45_4f39_45_9c7b_45_4c3a26dfe06f>
				</Properties>
				<ID>1000001</ID>
			</Node>
			<Name>Sequences</Name>
		</ProjectItem>
		<ProjectItemContainer Version="1">
			<Items Version="1">
				<Item Index="0" ObjectURef="a0774fea-d434-4071-921a-e6286675ae29"/>
			</Items>
		</ProjectItemContainer>
	</BinProjectItem>
	<VideoSettings ObjectID="12" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="13" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoCompileSettings ObjectID="14" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="28"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="15" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="29"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<DummyCaptureSettings ObjectID="16" ClassID="328c2aa2-47f9-4211-805b-b6a6dbd4ca29" Version="1">
	</DummyCaptureSettings>
	<DefaultSequenceSettings ObjectID="17" ClassID="567bdf53-d6d9-4d61-b2f1-f4834bebea9b" Version="2">
		<TotalVideoTracks>1</TotalVideoTracks>
		<DefaultAudioStandardMonoTracks>0</DefaultAudioStandardMonoTracks>
		<DefaultAudioStandardStereoTracks>1</DefaultAudioStandardStereoTracks>
		<DefaultAudioStandard51Tracks>0</DefaultAudioStandard51Tracks>
		<DefaultAudioSubmixMonoTracks>0</DefaultAudioSubmixMonoTracks>
		<DefaultAudioSubmixStereoTracks>0</DefaultAudioSubmixStereoTracks>
		<DefaultAudioSubmix51Tracks>0</DefaultAudioSubmix51Tracks>
	</DefaultSequenceSettings>
	<VideoCompileSettings ObjectID="18" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="30"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="19" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="31"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<VideoCompileSettings ObjectID="20" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="32"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="21" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="33"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<VideoCompileSettings ObjectID="22" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="34"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="23" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="35"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<VideoCompileSettings ObjectID="24" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="36"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="25" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="37"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<VideoCompileSettings ObjectID="26" ClassID="db372db5-7de2-4d3c-98ae-f42659d77b22" Version="9">
		<VideoSettings ObjectRef="38"/>
		<Compressor>1685480224</Compressor>
		<VideoCompilerClassIDFourCC>1061109567</VideoCompilerClassIDFourCC>
		<VideoFileTypeFourCC>1299148630</VideoFileTypeFourCC>
		<Depth>24</Depth>
		<RenderDepth>0</RenderDepth>
		<Aspect43>false</Aspect43>
		<Quality>100</Quality>
		<UseDataRate>false</UseDataRate>
		<DataRate>3500</DataRate>
		<ForceRecompress>true</ForceRecompress>
		<ForceRecompressValue>2</ForceRecompressValue>
		<Deinterlace>false</Deinterlace>
		<IgnoreVideoFilters>false</IgnoreVideoFilters>
		<OptimizeStills>false</OptimizeStills>
		<FramesAtMarkers>false</FramesAtMarkers>
		<RealTimePreview>true</RealTimePreview>
		<VideoFieldType>0</VideoFieldType>
		<DoKeyframeEveryNFrames>false</DoKeyframeEveryNFrames>
		<DoKeyframeEveryNFramesValue>0</DoKeyframeEveryNFramesValue>
		<AddKeyframesAtMarkers>false</AddKeyframesAtMarkers>
		<AddKeyframesAtEdits>false</AddKeyframesAtEdits>
		<RelativeFrameSize>1</RelativeFrameSize>
	</VideoCompileSettings>
	<AudioCompileSettings ObjectID="27" ClassID="34b10007-ab6d-49a7-bac5-7b60d919e387" Version="6">
		<AudioSettings ObjectRef="39"/>
		<Interleave>1</Interleave>
		<SampleType>3</SampleType>
		<Compressor>1380013856</Compressor>
	</AudioCompileSettings>
	<ClipProjectItem ObjectUID="a0774fea-d434-4071-921a-e6286675ae29" ClassID="cb4e0ed7-aca1-4171-8525-e3658dec06dd" Version="1">
		<ProjectItem Version="1">
			<Node Version="1">
				<Properties Version="1">
					<Column.PropertyText.Label>BE.Prefs.LabelColors.5</Column.PropertyText.Label>
				</Properties>
				<ID>1000002</ID>
			</Node>
			<Name>__PROJECT_NAME__</Name>
		</ProjectItem>
		<MasterClip ObjectURef="7131c00d-379b-434a-a61e-4fa19979dc65"/>
	</ClipProjectItem>
	<VideoSettings ObjectID="28" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="29" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoSettings ObjectID="30" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="31" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoSettings ObjectID="32" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="33" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoSettings ObjectID="34" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="35" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoSettings ObjectID="36" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="37" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
	<VideoSettings ObjectID="38" ClassID="58474264-30c4-43a2-bba5-dc0812df8a3a" Version="10">
	</VideoSettings>
	<AudioSettings ObjectID="39" ClassID="6baf5521-b132-4634-840e-13cec5bc86a4" Version="8">
	</AudioSettings>
`;

// The sequence MasterClip UID the scaffold's ClipProjectItem points at. Our
// editorial MasterClip(seq) MUST use this exact UID.
export const SEQ_MASTERCLIP_UID = "7131c00d-379b-434a-a61e-4fa19979dc65";

// Audio master-mixer chain. Top-level ObjectIDs 50-64. AudioMixTrack is 50 —
// AudioTrackGroup.MasterTrack must ObjectRef="50".
export const AUDIO_MIXER_OBJECT_ID = 50;
export const AUDIO_MIXER = `	<AudioMixTrack ObjectID="50" ClassID="4b1d8400-e89e-11d5-abc4-a1a13b1e80a0" Version="4">
		<AudioTrack Version="12">
			<ComponentOwner Version="1">
				<Components ObjectRef="53"/>
			</ComponentOwner>
			<Panner ObjectRef="54"/>
			<ID>5214f419-b81a-4759-998e-855f91d04727</ID>
			<SubType>3</SubType>
			<Assign>0</Assign>
			<NextPannerID>4294967279</NextPannerID>
			<FrameRate>5760000</FrameRate>
		</AudioTrack>
		<Track Version="4">
			<Node Version="1">
				<Properties Version="1">
					<TL.SQTrackExpanded>0</TL.SQTrackExpanded>
					<TL.SQTrackShy>0</TL.SQTrackShy>
					<TL.SQTrackAudioKeyframeStyle>2</TL.SQTrackAudioKeyframeStyle>
					<TL.SQTrackExpandedHeight>41</TL.SQTrackExpandedHeight>
				</Properties>
			</Node>
			<ID>1</ID>
			<MediaType>80b8e3d5-6dca-4195-aefb-cb5f407ab009</MediaType>
			<Index>0</Index>
		</Track>
		<Inlet ObjectRef="55"/>
	</AudioMixTrack>
	<AudioComponentChain ObjectID="51" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">
		<ComponentChain Version="3">
			<Components Version="1">
				<Component Index="0" ObjectRef="56"/>
				<Component Index="1" ObjectRef="57"/>
			</Components>
		</ComponentChain>
		<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
		<FrameRate>5760000</FrameRate>
		<ChannelType>1</ChannelType>
	</AudioComponentChain>
	<StereoToStereoPanProcessor ObjectID="52" ClassID="7bf86a01-efbe-11d5-abc4-c1ce2b1e9090" Version="1">
		<PanProcessor Version="3">
			<AudioComponent Version="3">
				<Component Version="7">
					<Params Version="1">
						<Param Index="0" ObjectRef="58"/>
					</Params>
					<ID>4294967280</ID>
				</Component>
				<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
				<AudioComponentType>0</AudioComponentType>
				<FrameRate>5760000</FrameRate>
				<ChannelType>1</ChannelType>
			</AudioComponent>
		</PanProcessor>
	</StereoToStereoPanProcessor>
	<AudioComponentChain ObjectID="53" ClassID="3cb131d1-d3c0-47ae-a19a-bdf75ea11674" Version="3">
		<ComponentChain Version="3">
			<Node Version="1">
				<Properties Version="1">
					<MZ.ComponentChain.ActiveComponentID>1</MZ.ComponentChain.ActiveComponentID>
					<MZ.ComponentChain.ActiveComponentParamIndex>4294967295</MZ.ComponentChain.ActiveComponentParamIndex>
				</Properties>
			</Node>
			<Components Version="1">
				<Component Index="0" ObjectRef="59"/>
				<Component Index="1" ObjectRef="60"/>
			</Components>
		</ComponentChain>
		<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
		<FrameRate>5760000</FrameRate>
		<ChannelType>1</ChannelType>
	</AudioComponentChain>
	<DefaultPanProcessor ObjectID="54" ClassID="33a94282-ee2c-11d5-abc4-c1cd7f9e3c10" Version="2">
		<PanProcessor Version="3">
			<AudioComponent Version="3">
				<Component Version="7">
					<ID>4294967280</ID>
				</Component>
				<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
				<AudioComponentType>0</AudioComponentType>
				<FrameRate>5760000</FrameRate>
				<ChannelType>1</ChannelType>
			</AudioComponent>
		</PanProcessor>
		<DefaultPannerOutputChannelType>1</DefaultPannerOutputChannelType>
		<DefaultPannerInputChannelType>1</DefaultPannerInputChannelType>
	</DefaultPanProcessor>
	<AudioTrackInlet ObjectID="55" ClassID="be3af080-e8c6-11d5-abc4-a1c6d5dee670" Version="3">
		<Sources Version="1">
			<Source Index="0" ObjectURef="__A1_TRACK_UID__"/>
		</Sources>
		<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
		<FrameRate>5760000</FrameRate>
	</AudioTrackInlet>
	<AudioFader ObjectID="56" ClassID="1a38c583-ed5c-11d5-abc4-c1cbf61ec590" Version="3">
		<AudioComponent Version="3">
			<Component Version="7">
				<Params Version="1">
					<Param Index="0" ObjectRef="61"/>
					<Param Index="1" ObjectRef="62"/>
				</Params>
				<ID>1</ID>
			</Component>
			<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
			<AudioComponentType>1</AudioComponentType>
			<FrameRate>5760000</FrameRate>
			<ChannelType>1</ChannelType>
		</AudioComponent>
	</AudioFader>
	<AudioMeter ObjectID="57" ClassID="72ea4700-f615-11d5-abc4-c186585e63e0" Version="2">
		<AudioComponent Version="3">
			<Component Version="7">
				<ID>2</ID>
			</Component>
			<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
			<AudioComponentType>2</AudioComponentType>
			<FrameRate>5760000</FrameRate>
			<ChannelType>1</ChannelType>
		</AudioComponent>
	</AudioMeter>
	<AudioComponentParam ObjectID="58" ClassID="a714635e-a628-4b27-9d59-77eba47dbc1a" Version="9">
		<StartKeyframe>-91445760000000000,0.5,0,0,0,0,0,0</StartKeyframe>
		<CurrentValue>0.5</CurrentValue>
		<IsInverted>true</IsInverted>
		<Name>Balance</Name>
	</AudioComponentParam>
	<AudioFader ObjectID="59" ClassID="1a38c583-ed5c-11d5-abc4-c1cbf61ec590" Version="3">
		<AudioComponent Version="3">
			<Component Version="7">
				<Params Version="1">
					<Param Index="0" ObjectRef="63"/>
					<Param Index="1" ObjectRef="64"/>
				</Params>
				<ID>1</ID>
			</Component>
			<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
			<AudioComponentType>1</AudioComponentType>
			<FrameRate>5760000</FrameRate>
			<ChannelType>1</ChannelType>
		</AudioComponent>
	</AudioFader>
	<AudioMeter ObjectID="60" ClassID="72ea4700-f615-11d5-abc4-c186585e63e0" Version="2">
		<AudioComponent Version="3">
			<Component Version="7">
				<ID>2</ID>
			</Component>
			<AudioChannelLayout>[{"channellabel":100},{"channellabel":101}]</AudioChannelLayout>
			<AudioComponentType>2</AudioComponentType>
			<FrameRate>5760000</FrameRate>
			<ChannelType>1</ChannelType>
		</AudioComponent>
	</AudioMeter>
	<AudioComponentParam ObjectID="61" ClassID="a714635e-a628-4b27-9d59-77eba47dbc1a" Version="9">
		<RangeLocked>false</RangeLocked>
		<UnitsString>dB</UnitsString>
		<UpperBound>5.6234130859375</UpperBound>
		<Name>Volume</Name>
	</AudioComponentParam>
	<AudioComponentParam ObjectID="62" ClassID="32657501-3aa4-445f-a49b-d09ecb9fa1ae" Version="9">
		<RangeLocked>false</RangeLocked>
		<Name>Mute</Name>
	</AudioComponentParam>
	<AudioComponentParam ObjectID="63" ClassID="a714635e-a628-4b27-9d59-77eba47dbc1a" Version="9">
		<RangeLocked>false</RangeLocked>
		<UnitsString>dB</UnitsString>
		<UpperBound>5.6234130859375</UpperBound>
		<Name>Volume</Name>
	</AudioComponentParam>
	<AudioComponentParam ObjectID="64" ClassID="32657501-3aa4-445f-a49b-d09ecb9fa1ae" Version="9">
		<RangeLocked>false</RangeLocked>
		<Name>Mute</Name>
	</AudioComponentParam>
`;

// ── Per-clip editorial template ──────────────────────────────────────────────
// One complete video clip's object subgraph (22 objects: VideoClipTrackItem,
// SubClip, VideoClip×2, VideoMediaSource, Media, VideoStream, Markers,
// VideoComponentChain, VideoFilterComponent (Motion) + 11 params, MasterClip,
// ClipLoggingInfo), extracted verbatim from a real Premiere-accepted file. Stamp
// it once per clip with fresh IDs and the clip's path/trim/position/dimensions.
//
// Placeholders (all substituted per clip in prproj.ts):
//   IDs:    __VCTI_ID__ __VCC_ID__ __SUBCLIP_ID__ __VFC_ID__ __VIDEOCLIP_ID__
//           __MC_VIDEOCLIP_ID__ __VMS_ID__ __LOG_ID__ __VSTREAM_ID__ __MARKERS_ID__
//           __PARAM0__..__PARAM10__ __NODE_ID__
//   UIDs:   __MASTERCLIP_UID__ __MEDIA_UID__
//   timing: __START__ __END__ (timeline ticks)  __INPOINT__ __OUTPOINT__ (trim)
//   source: __SRC_PATH__ __SRC_BASE__ __WIDTH__ __HEIGHT__ __SRC_DURATION__ __FRAMERATE__
//   uuids:  __CLIP_UUID__ __CLIP_UUID2__ __DEFMAP_UUID__ __FILE_KEY__ __CONTENT_STATE__
//           __MOD_HASH__ __MOD_BODY__  (MOD_BODY = UUID as UTF-16LE base64)
export const CLIP_TEMPLATE = `	<VideoClipTrackItem ObjectID="__VCTI_ID__" ClassID="368b0406-29e3-4923-9fcd-094fbf9a1089" Version="8">
		<ClipTrackItem Version="8">
			<ComponentOwner Version="1">
				<Components ObjectRef="__VCC_ID__"/>
			</ComponentOwner>
			<TrackItem Version="3">
				<Node Version="1">
					<ID>__NODE_ID__</ID>
				</Node>
				<Start>__START__</Start>
				<End>__END__</End>
			</TrackItem>
			<SubClip ObjectRef="__SUBCLIP_ID__"/>
		</ClipTrackItem>
		<FrameRect>0,0,__WIDTH__,__HEIGHT__</FrameRect>
		<PixelAspectRatio>1,1</PixelAspectRatio>
		<ToneMapSettings>{"peak":-1,"version":3}</ToneMapSettings>
	</VideoClipTrackItem>

	<VideoComponentChain ObjectID="__VCC_ID__" ClassID="0970e08a-f58f-4108-b29a-1a717b8e12e2" Version="3">
		<DefaultOpacity>true</DefaultOpacity>
		<DefaultOpacityComponentID>2</DefaultOpacityComponentID>
		<ComponentChain Version="3">
			<Node Version="1">
				<Properties Version="1">
					<MZ.ComponentChain.ActiveComponentID>2</MZ.ComponentChain.ActiveComponentID>
					<MZ.ComponentChain.ActiveComponentParamIndex>4294967295</MZ.ComponentChain.ActiveComponentParamIndex>
				</Properties>
			</Node>
			<Components Version="1">
				<Component Index="0" ObjectRef="__VFC_ID__"/>
			</Components>
		</ComponentChain>
	</VideoComponentChain>

	<SubClip ObjectID="__SUBCLIP_ID__" ClassID="e0c58dc9-dbdd-4166-aef7-5db7e3f22e84" Version="6">
		<Clip ObjectRef="__VIDEOCLIP_ID__"/>
		<MasterClip ObjectURef="__MASTERCLIP_UID__"/>
		<OrigChGrp>0</OrigChGrp>
		<Name>__SRC_BASE__</Name>
	</SubClip>

	<VideoFilterComponent ObjectID="__VFC_ID__" ClassID="d10da199-beea-4dd1-b941-ed3a78766d50" Version="9">
		<Component Version="6">
			<Params Version="1">
				<Param Index="0" ObjectRef="__PARAM0__"/>
				<Param Index="1" ObjectRef="__PARAM1__"/>
				<Param Index="2" ObjectRef="__PARAM2__"/>
				<Param Index="3" ObjectRef="__PARAM3__"/>
				<Param Index="4" ObjectRef="__PARAM4__"/>
				<Param Index="5" ObjectRef="__PARAM5__"/>
				<Param Index="6" ObjectRef="__PARAM6__"/>
				<Param Index="7" ObjectRef="__PARAM7__"/>
				<Param Index="8" ObjectRef="__PARAM8__"/>
				<Param Index="9" ObjectRef="__PARAM9__"/>
				<Param Index="10" ObjectRef="__PARAM10__"/>
			</Params>
			<ID>1</ID>
			<Bypass>false</Bypass>
			<DisplayName>Motion</DisplayName>
			<Intrinsic>true</Intrinsic>
			<ArchivedType>0</ArchivedType>
		</Component>
		<MatchName>AE.ADBE Motion</MatchName>
		<VideoFilterType>2</VideoFilterType>
	</VideoFilterComponent>

	<VideoClip ObjectID="__VIDEOCLIP_ID__" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="11">
		<Clip Version="18">
			<Node Version="1">
				<Properties Version="1">
					<asl.clip.label.color>6769408</asl.clip.label.color>
					<asl.clip.label.name>BE.Prefs.LabelColors.1</asl.clip.label.name>
				</Properties>
			</Node>
			<MarkerOwner Version="1">
				<Markers ObjectRef="__MARKERS_ID__"/>
			</MarkerOwner>
			<Source ObjectRef="__VMS_ID__"/>
			<ClipID>__CLIP_UUID__</ClipID>
			<InPoint>__INPOINT__</InPoint>
			<OutPoint>__OUTPOINT__</OutPoint>
		</Clip>
	</VideoClip>

	<MasterClip ObjectUID="__MASTERCLIP_UID__" ClassID="fb11c33a-b0a9-4465-aa94-b6d5db2628cf" Version="12">
		<LoggingInfo ObjectRef="__LOG_ID__"/>
		<Clips Version="1">
			<Clip Index="0" ObjectRef="__MC_VIDEOCLIP_ID__"/>
		</Clips>
		<Name>__SRC_BASE__</Name>
		<DefMappingID>__DEFMAP_UUID__</DefMappingID>
		<MasterClipChangeVersion>0</MasterClipChangeVersion>
	</MasterClip>

	<PointComponentParam ObjectID="__PARAM0__" ClassID="ca81d347-309b-44d2-acc7-1c572efb973c" Version="3">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>6</ParameterControlType>
		<ParameterID>1</ParameterID>
		<Name>Position</Name>
		<StartKeyframe>-91445760000000000,0.5:0.5,0,0,0,0,0,0,5,4,0,0,0,0</StartKeyframe>
	</PointComponentParam>

	<VideoComponentParam ObjectID="__PARAM1__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<UpperUIBound>200</UpperUIBound>
		<ParameterID>2</ParameterID>
		<Name>Scale</Name>
		<StartKeyframe>-91445760000000000,50.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>10000</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM2__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<UpperUIBound>200</UpperUIBound>
		<ParameterID>3</ParameterID>
		<Name>Scale Width</Name>
		<StartKeyframe>-91445760000000000,100.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>10000</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM3__" ClassID="cc12343e-f113-4d3b-ae05-b287db77d461" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>4</ParameterControlType>
		<ParameterID>4</ParameterID>
		<Name> </Name>
		<StartKeyframe>-91445760000000000,true,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>false</LowerBound>
		<UpperBound>true</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM4__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>3</ParameterControlType>
		<ParameterID>5</ParameterID>
		<Name>Rotation</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>-32768</LowerBound>
		<UpperBound>32767</UpperBound>
	</VideoComponentParam>

	<PointComponentParam ObjectID="__PARAM5__" ClassID="ca81d347-309b-44d2-acc7-1c572efb973c" Version="3">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>6</ParameterControlType>
		<ParameterID>6</ParameterID>
		<Name>Anchor Point</Name>
		<StartKeyframe>-91445760000000000,0.5:0.5,0,0,0,0,0,0,5,4,0,0,0,0</StartKeyframe>
	</PointComponentParam>

	<VideoComponentParam ObjectID="__PARAM6__" ClassID="a4ff2d6e-7ac2-44f8-9d52-17d9ca50e542" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>8</ParameterControlType>
		<ParameterID>7</ParameterID>
		<Name>Anti-flicker Filter</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>1</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM7__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<ParameterID>8</ParameterID>
		<Name>Crop Left</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>100</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM8__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<ParameterID>9</ParameterID>
		<Name>Crop Top</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>100</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM9__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<ParameterID>10</ParameterID>
		<Name>Crop Right</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>100</UpperBound>
	</VideoComponentParam>

	<VideoComponentParam ObjectID="__PARAM10__" ClassID="fe47129e-6c94-4fc0-95d5-c056a517aaf3" Version="9">
		<IsTimeVarying>false</IsTimeVarying>
		<ParameterControlType>2</ParameterControlType>
		<ParameterID>11</ParameterID>
		<Name>Crop Bottom</Name>
		<StartKeyframe>-91445760000000000,0.,0,0,0,0,0,0</StartKeyframe>
		<LowerBound>0</LowerBound>
		<UpperBound>100</UpperBound>
	</VideoComponentParam>

	<VideoMediaSource ObjectID="__VMS_ID__" ClassID="e64ddf74-8fac-4682-8aa8-0e0ca2248949" Version="2">
		<MediaSource Version="4">
			<Content Version="10">
			</Content>
			<Media ObjectURef="__MEDIA_UID__"/>
		</MediaSource>
		<OriginalDuration>__SRC_DURATION__</OriginalDuration>
	</VideoMediaSource>

	<ClipLoggingInfo ObjectID="__LOG_ID__" ClassID="77ab7fdd-dcdf-465d-9906-7a330ca1e738" Version="10">
		<CaptureMode>2</CaptureMode>
		<ClipName>__SRC_BASE__</ClipName>
		<TimecodeFormat>104</TimecodeFormat>
		<MediaInPoint>0</MediaInPoint>
		<MediaOutPoint>__SRC_DURATION__</MediaOutPoint>
		<MediaFrameRate>__FRAMERATE__</MediaFrameRate>
	</ClipLoggingInfo>

	<VideoClip ObjectID="__MC_VIDEOCLIP_ID__" ClassID="9308dbef-2440-4acb-9ab2-953b9a4e82ec" Version="11">
		<Clip Version="18">
			<Node Version="1">
				<Properties Version="1">
					<asl.clip.label.name>BE.Prefs.LabelColors.1</asl.clip.label.name>
					<asl.clip.label.color>6769408</asl.clip.label.color>
				</Properties>
			</Node>
			<Source ObjectRef="__VMS_ID__"/>
			<ClipID>__CLIP_UUID2__</ClipID>
			<InUse>false</InUse>
		</Clip>
	</VideoClip>

	<Media ObjectUID="__MEDIA_UID__" ClassID="7a5c103e-f3ac-4391-b6b4-7cc3d2f9a7ff" Version="30">
		<VideoStream ObjectRef="__VSTREAM_ID__"/>
		<ModificationState Encoding="base64" BinaryHash="__MOD_HASH__">__MOD_BODY__</ModificationState>
		<FilePath>__SRC_PATH__</FilePath>
		<ImplementationID>1fa18bfa-255c-44b1-ad73-56bcd99fceaf</ImplementationID>
		<Title>__SRC_BASE__</Title>
		<FileKey>__FILE_KEY__</FileKey>
		<ConformedAudioRate>5760000</ConformedAudioRate>
		<ContentAndMetadataState>__CONTENT_STATE__</ContentAndMetadataState>
		<RelativePath>__SRC_BASE__</RelativePath>
		<ActualMediaFilePath>__SRC_PATH__</ActualMediaFilePath>
	</Media>

	<VideoStream ObjectID="__VSTREAM_ID__" ClassID="a36e4719-3ec6-4a0c-ab11-8b4aab377aa5" Version="22">
		<Duration>__SRC_DURATION__</Duration>
		<CodecType>1635148593</CodecType>
		<FrameRect>0,0,__WIDTH__,__HEIGHT__</FrameRect>
		<OriginalColorSpace>{"baseColorProfile":{"colorProfileData":"AQAAAP////8=","colorProfileName":"BT.709,8-bit,Display-Referred"},"baseProfileType":1}</OriginalColorSpace>
		<AlphaType>3</AlphaType>
		<FieldTypeIsUncertain>true</FieldTypeIsUncertain>
		<OriginalImageOrientationType>1</OriginalImageOrientationType>
		<FrameRate>__FRAMERATE__</FrameRate>
		<IgnoreAlpha>true</IgnoreAlpha>
	</VideoStream>

`;

// Empty per-clip Markers object (referenced by VideoClip.MarkerOwner).
export const MARKERS_TEMPLATE = `	<Markers ObjectID="__MARKERS_ID__" ClassID="bee50706-b524-416c-9f03-b596ce5f6866" Version="4">
		<Markers Version="1">
		</Markers>
		<LastMetadataState>00000000-0000-0000-0000-000000000000</LastMetadataState>
		<LastContentState>00000000-0000-0000-0000-000000000000</LastContentState>
	</Markers>
`;
